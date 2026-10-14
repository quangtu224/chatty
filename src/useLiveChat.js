import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getMe, getConversations, openDirect, getMessages, getMessagesAfter, sendMessage, markRead as putRead,
  getConversation, createGroup, addMembers, removeMember, transferOwner, leaveGroup, joinGroup } from './services/api.js';
import { mergeMessages, viewConversation, latestSeq, countsAsUnread, withPresence, contiguousSeq, mergeReadState } from './services/chat-model.js';
import { messageBodyError } from './model.js';

// Owns live data only. Cleanup invalidates late responses from a previous account.
// onRevoked(id, name) runs when another tab, the owner or the server removes my access.
export default function useLiveChat(user, active, notify, onExpired, onRevoked) {
  const [chats, setChats] = useState([]), [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(false), [loadingOlder, setLoadingOlder] = useState(false);
  const [network, setNetwork] = useState('reconnecting'), [error, setError] = useState('');
  const [historyVersion,setHistoryVersion]=useState(0);
  const [roomVersion,setRoomVersion]=useState(0);
  const knownChats=useRef(chats); knownChats.current=chats;
  const scope = useRef(null), callbacks = useRef({notify,onExpired,onRevoked});
  callbacks.current = {notify,onExpired,onRevoked};
  // Groups this tab is leaving: their access-revoked push is expected, not news.
  const leaving = useRef(new Set());
  // M3d presence/typing (ephemeral, never stored). online: contact ids with an open socket;
  // typing: { conversationId: [userId] }, each entry expiring 5 s after its last refresh.
  const [online,setOnline]=useState(()=>new Set()), [typing,setTyping]=useState({});
  const socketRef=useRef(null), typingTimers=useRef(new Map()), typingSent=useRef({id:null,at:0});
  function setTypist(conversationId, userId, on) {
    const key=`${conversationId}:${userId}`;
    clearTimeout(typingTimers.current.get(key));
    typingTimers.current.delete(key);
    // Expire after 5 s without a refresh (the typist's tab may have closed mid-word).
    if (on) typingTimers.current.set(key, setTimeout(()=>setTypist(conversationId,userId,false), 5000));
    setTyping(t=>{
      const ids=(t[conversationId]??[]).filter(id=>id!==userId);
      return {...t,[conversationId]:on ? [...ids,userId] : ids};
    });
  }
  // Tells the other members I am (not) typing in `id`. Repeats of "typing" are sent at
  // most every 3 s, which keeps the receivers' 5 s expiry alive while I keep typing.
  function signalTyping(id, on) {
    const socket=socketRef.current, last=typingSent.current;
    if (!socket?.connected || !id) return;
    if (on && last.id===id && Date.now()-last.at<3000) return;
    if (!on && last.id!==id) return; // nothing to stop
    typingSent.current=on ? {id,at:Date.now()} : {id:null,at:0};
    socket.emit('typing:set',{conversationId:id,typing:on});
  }
  const key = user ? `chatty.live-drafts.${user.id}` : null;
  function report(err) {
    if (err.status === 401) { clearDrafts(); callbacks.current.onExpired(); }
    else callbacks.current.notify(err.message || 'Unable to reach the server.', '!');
  }
  function merge(id, messages) {
    setChats(cs => cs.map(c => c.id === id ? {...c,
      messages:mergeMessages(c.messages ?? [], messages),
      lastMessage: [...messages, c.lastMessage].filter(Boolean).sort((a,b)=>b.seq-a.seq)[0],
    } : c));
  }
  // Inserts or updates one conversation from a details/create response. Server `members`
  // (public profiles) are stored as memberProfiles; viewConversation derives the rest.
  function upsert(conversation) {
    const { members, ...rest } = conversation;
    const extra = members ? { memberProfiles: members } : {};
    setChats(cs => cs.some(c => c.id === rest.id)
      ? cs.map(c => c.id === rest.id ? {...c, ...mergeReadState(c, rest), ...extra,
          lastMessage: c.lastMessage?.seq > (rest.lastMessage?.seq ?? 0) ? c.lastMessage : rest.lastMessage} : c)
      : [{...rest, ...extra, messages: []}, ...cs]);
  }
  function drop(id) {
    setChats(cs => cs.filter(c => c.id !== id));
  }
  // Background refresh of one conversation (events, opening a group). 404 means my access
  // is gone; other failures stay quiet because the next list refresh repairs the view.
  async function loadDetails(id, token = scope.current) {
    try {
      const { conversation } = await getConversation(id);
      if (scope.current === token) upsert(conversation);
    } catch (err) {
      if (scope.current !== token) return;
      if (err.status === 404) drop(id);
      else if (err.status === 401) report(err);
    }
  }
  // M4 catch-up: fetches every page after the contiguous cursor of a conversation that
  // already has messages, so reconnects and missed pushes never leave holes. A call while
  // one is running asks it for one more round instead of starting a parallel loop.
  const syncing = useRef(new Map());
  async function catchUp(id, token = scope.current) {
    const running = syncing.current.get(id);
    if (running) { running.again = true; return; }
    const state = { again: true };
    syncing.current.set(id, state);
    let fetched = 0;
    try {
      while (state.again && scope.current === token) {
        state.again = false;
        const c = knownChats.current.find(item => item.id === id);
        if (!c?.messages?.length) break;
        // Pages are contiguous after `after` (server seqs have no holes), so the cursor
        // advances locally; knownChats only catches up after the next render.
        let after = contiguousSeq(c.messages), more = true;
        while (more && scope.current === token) {
          const page = await getMessagesAfter(id, after);
          if (scope.current !== token) return;
          merge(id, page.messages);
          fetched += page.messages.length;
          after = page.messages.at(-1)?.seq ?? after;
          more = page.hasMore;
        }
      }
      // Fetched messages bypass the push counter; the server knows the true unread count.
      if (fetched && scope.current === token) loadDetails(id, token);
    } catch (err) {
      // Quiet like loadDetails: the hole stays and the next reconnect/selection retries.
      if (scope.current !== token) return;
      if (err.status === 404) drop(id);
      else if (err.status === 401) report(err);
    } finally {
      if (syncing.current.get(id) === state) syncing.current.delete(id);
    }
  }
  async function refresh(token) {
    const { conversations } = await getConversations();
    if (scope.current !== token) return;
    setChats(cs => conversations.map(c => {
      const old = cs.find(item=>item.id===c.id);
      return {...old,...mergeReadState(old,c), lastMessage: old?.lastMessage?.seq > (c.lastMessage?.seq ?? 0) ? old.lastMessage : c.lastMessage,
        messages:old?.messages ?? [], hasMore:old?.hasMore};
    }));
    setError('');
  }
  useEffect(() => {
    setChats([]); setDrafts({}); setError(''); setLoadingOlder(false); setLoading(false);
    setOnline(new Set()); setTyping({});
    if (!user) return;
    const token = {userId:user.id}; scope.current = token;
    try {
      const saved=JSON.parse(sessionStorage.getItem(key) || '{}');
      if(saved && typeof saved==='object' && !Array.isArray(saved))
        setDrafts(Object.fromEntries(Object.entries(saved).filter(([,value])=>typeof value==='string')));
    } catch { /* Storage can be disabled. */ }
    setLoading(true);
    const socket = io({transports:['websocket']});
    socket.on('groups:updated',()=>setRoomVersion(n=>n+1));
    socket.on('connect',()=>setRoomVersion(n=>n+1));
    socketRef.current = socket; typingSent.current = {id:null,at:0};
    const failed = err => { if (scope.current === token) report(err); };
    const checkSession = async reconnect => {
      try {
        const result=await getMe();
        if(scope.current!==token)return;
        // Another tab can rotate the cookie to a different account.
        if(result.user.id!==user.id){clearDrafts();callbacks.current.onExpired();}
        else if(reconnect)socket.connect();
      }catch(err){failed(err);}
    };
    const reload = () => refresh(token).catch(err=>{
      if (scope.current === token) { setError(err.message); failed(err); }
    }).finally(()=>{ if (scope.current === token) setLoading(false); });
    // (Re)connect: refresh the list (memberships, unread), then fill every loaded chat's
    // gap since its contiguous cursor. Loaded chats are known before the refresh renders.
    socket.on('connect', () => {
      setNetwork('online');
      const loaded = knownChats.current.filter(c => c.messages?.length).map(c => c.id);
      reload().then(() => loaded.forEach(id => catchUp(id, token)));
    });
    socket.on('disconnect', reason => {
      // Presence and typing are unknown while disconnected; the next connect sends a snapshot.
      setOnline(new Set()); setTyping({}); typingSent.current = {id:null,at:0};
      setNetwork(navigator.onLine ? 'reconnecting' : 'offline');
      if (reason === 'io server disconnect') checkSession(true);
    });
    socket.on('connect_error', () => {
      setNetwork(navigator.onLine ? 'reconnecting' : 'offline');
      checkSession(false);
    });
    // { userIds, online }: a snapshot right after connecting, then single changes.
    socket.on('presence:updated', ({ userIds, online: on }) => setOnline(prev => {
      const next = new Set(prev);
      for (const id of userIds) on ? next.add(id) : next.delete(id);
      return next;
    }));
    socket.on('typing:updated', ({ conversationId, userId, typing: on }) => setTypist(conversationId, userId, on));
    // No clearing on message:created: the sender's own typing:false (same socket, in order)
    // ends it, while the REST-driven message push can arrive after they started typing again.
    socket.on('message:created', message => {
      // Known chats update immediately, even if an unrelated list request fails.
      // Raise the badge first: countsAsUnread compares against the state before the merge.
      const known=knownChats.current.find(c=>c.id===message.conversationId);
      if(known) {
        setChats(cs=>cs.map(c=>c.id===message.conversationId && countsAsUnread(c,message,user.id)
          ? {...c,unreadCount:(c.unreadCount??0)+1} : c));
        merge(message.conversationId,[message]);
        // A seq jump means pushes were missed (e.g. a brief disconnect): keep this message
        // (the cursor stays before the hole) and fetch what is missing.
        if (known.messages?.length && message.seq > contiguousSeq(known.messages)+1)
          catchUp(message.conversationId, token);
      }
      else refresh(token).then(()=>{ if (scope.current === token) merge(message.conversationId,[message]); }).catch(failed);
    });
    // Group changed (created, members, owner): refetch my view of it; new groups appear.
    socket.on('conversation:updated', ({ conversationId }) => loadDetails(conversationId, token));
    socket.on('conversation:access-revoked', ({ conversationId }) => {
      const known = knownChats.current.find(c => c.id === conversationId);
      drop(conversationId);
      if (known && !leaving.current.has(conversationId))
        callbacks.current.onRevoked?.(conversationId, known.name);
    });
    // Another tab of mine read this chat. Fully read: clear at once; otherwise the exact
    // count needs the server (only it knows who sent the messages I have not loaded).
    socket.on('read:updated', ({ conversationId, lastReadSeq }) => {
      const c = knownChats.current.find(item => item.id === conversationId);
      if (!c || lastReadSeq <= (c.lastReadSeq ?? 0)) return;
      if (lastReadSeq >= Math.max(latestSeq(c.messages), c.lastMessage?.seq ?? 0))
        setChats(cs => cs.map(item => item.id === conversationId
          ? {...item, lastReadSeq: Math.max(item.lastReadSeq ?? 0, lastReadSeq), unreadCount: 0} : item));
      else loadDetails(conversationId, token);
    });
    reload();
    return () => {
      scope.current = null; socketRef.current = null; socket.disconnect(); syncing.current.clear();
      typingTimers.current.forEach(clearTimeout); typingTimers.current.clear();
    };
  }, [user?.id]);
  useEffect(() => {
    if (!user || !active) return;
    const token = scope.current; let cancelled = false;
    // Groups need member profiles for author names and the details dialog.
    const known=knownChats.current.find(c=>c.id===active);
    if (known?.type==='group') loadDetails(active, token);
    // Already loaded: continue after the contiguous cursor. Fetching the latest page here
    // instead would leave a hole whenever more than one page arrived since.
    if (known?.messages?.length) { catchUp(active, token); return; }
    setChats(cs=>cs.map(c=>c.id===active ? {...c,historyLoading:true,historyError:''} : c));
    getMessages(active).then(page => {
      if (cancelled || scope.current !== token) return;
      setChats(cs=>cs.map(c=>c.id===active ? {...c,messages:mergeMessages(c.messages??[],page.messages),hasMore:page.hasMore,historyLoading:false} : c));
    }).catch(err=>{ if (!cancelled && scope.current===token) {
      setChats(cs=>cs.map(c=>c.id===active ? {...c,historyError:err.message,historyLoading:false} : c));
      report(err);
    } });
    return ()=>{ cancelled=true; };
  }, [user?.id,active,historyVersion]);
  // Leaving a chat (switching or closing it) stops my typing indicator there.
  useEffect(() => () => signalTyping(active,false), [active]);
  function setDraft(value) {
    signalTyping(active, value.trim()!=='');
    setDrafts(ds=>{
      const next = {...ds,[active]:value};
      try { sessionStorage.setItem(key,JSON.stringify(next)); } catch { /* Keep the in-memory draft. */ }
      return next;
    });
  }
  async function direct(person) {
    const token=scope.current;
    const {conversation}=await openDirect(person.id);
    if (scope.current!==token) return null;
    setChats(cs=>cs.some(c=>c.id===conversation.id) ? cs : [ {...conversation,messages:[]}, ...cs ]);
    return conversation.id;
  }
  async function transmit(id, message) {
    const token=scope.current;
    merge(id,[{...message,status:'sending'}]);
    try {
      const result=await sendMessage(id,{clientMessageId:message.clientMessageId,body:message.body,kind:message.kind,gifId:message.gifId});
      if (scope.current===token) merge(id,[result.message]);
    } catch(err) {
      if (scope.current!==token) return;
      // A push may have confirmed the write before the REST response was lost.
      setChats(cs=>cs.map(c=>c.id===id ? {...c,messages:c.messages.map(m=>m.clientMessageId===message.clientMessageId && m.senderId===user.id && !m.seq ? {...m,status:'failed'} : m)} : c));
      report(err);
    }
  }
  function send(gif) {
    const body=gif?.title || (drafts[active]??'').trim();
    const invalid=messageBodyError(body);
    if (invalid) return callbacks.current.notify(invalid,'!');
    if (!active) return;
    const id=crypto.randomUUID();
    const message={id,clientMessageId:id,senderId:user.id,body,kind:gif?'gif':'text',gifId:gif?.id??null,createdAt:new Date().toISOString()};
    setDraft(''); transmit(active,message); // setDraft('') also stops typing
  }
  function retry(id) {
    const message=chats.find(c=>c.id===active)?.messages.find(m=>m.id===id);
    if (message?.status==='failed') transmit(active,message);
  }
  async function older() {
    const c=chats.find(c=>c.id===active), token=scope.current;
    const before=c?.messages.find(m=>m.seq)?.seq;
    if (!before || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page=await getMessages(c.id,before);
      if (scope.current!==token) return;
      setChats(cs=>cs.map(item=>item.id===c.id ? {...item,messages:mergeMessages(item.messages,page.messages),hasMore:page.hasMore} : item));
    } catch(err) { if (scope.current===token) report(err); }
    finally { if (scope.current===token) setLoadingOlder(false); }
  }
  // Called by Chat only while the active chat is on screen, the tab is visible and the
  // history is scrolled to the newest message. Updates the badge at once, then the server.
  function markRead() {
    const c=chats.find(item=>item.id===active), token=scope.current;
    // Only up to the contiguous cursor: never mark unseen messages in a hole as read.
    const seq=contiguousSeq(c?.messages);
    if (!c || !seq || seq<=(c.lastReadSeq??0)) return;
    const all=seq>=latestSeq(c.messages);
    setChats(cs=>cs.map(item=>item.id===c.id ? {...item,lastReadSeq:seq,unreadCount:all ? 0 : item.unreadCount} : item));
    putRead(c.id,seq).then(result=>{
      if (scope.current!==token) return;
      // Another tab may have read further; keep the higher cursor.
      setChats(cs=>cs.map(item=>item.id===c.id ? {...item,lastReadSeq:Math.max(item.lastReadSeq??0,result.lastReadSeq)} : item));
    }).catch(err=>{
      // A failed read update is harmless: the next list refresh restores the true count.
      if (scope.current===token && err.status===401) report(err);
    });
  }
  // Group actions. Each resolves after the server confirmed; errors reach the caller.
  async function group(name, memberIds) {
    const token=scope.current;
    const {conversation}=await createGroup(name, memberIds);
    if (scope.current!==token) return null;
    upsert(conversation);
    return conversation.id;
  }
  async function add(id, userIds) {
    const token=scope.current;
    const {conversation}=await addMembers(id, userIds);
    if(scope.current!==token)return;
    upsert(conversation);
  }
  async function remove(id, userId) {
    await removeMember(id, userId);
    await loadDetails(id);
  }
  async function transfer(id, userId) {
    const token=scope.current;
    const {conversation}=await transferOwner(id, userId);
    if(scope.current!==token)return;
    upsert(conversation);
  }
  async function leave(id) {
    leaving.current.add(id);
    try {
      await leaveGroup(id);
      drop(id);
    } finally { leaving.current.delete(id); }
  }
  async function join(id){
    const token=scope.current;const {conversation}=await joinGroup(id);
    if(scope.current!==token)return null;upsert(conversation);setRoomVersion(n=>n+1);return id;
  }
  function clearDrafts() { try { sessionStorage.removeItem(key); } catch { /* Storage can be disabled. */ } }
  const owned=scope.current?.userId===user?.id;
  return {roomVersion,join,chats:owned ? [...chats].sort((a,b)=>new Date(b.lastMessage?.createdAt??0)-new Date(a.lastMessage?.createdAt??0)).map(c=>withPresence(viewConversation(c,user?.id),online,typing[c.id])) : [],draft:owned ? drafts[active]??'' : '',setDraft,send,retry,direct,older,markRead,group,add,remove,transfer,leave,loading,loadingOlder,network,error,reloadHistory:()=>setHistoryVersion(v=>v+1),
    reload:()=>{const token=scope.current;return refresh(token).catch(err=>{if(scope.current===token)report(err);});},clearDrafts};
}
