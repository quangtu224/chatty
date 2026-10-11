import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getMe, getConversations, openDirect, getMessages, sendMessage } from './services/api.js';
import { mergeMessages, viewConversation } from './services/chat-model.js';
import { messageBodyError } from './model.js';

// Owns live data only. Cleanup invalidates late responses from a previous account.
export default function useLiveChat(user, active, notify, onExpired) {
  const [chats, setChats] = useState([]), [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(false), [loadingOlder, setLoadingOlder] = useState(false);
  const [network, setNetwork] = useState('reconnecting'), [error, setError] = useState('');
  const scope = useRef(null), callbacks = useRef({notify,onExpired});
  callbacks.current = {notify,onExpired};
  const key = user ? `chatty.live-drafts.${user.id}` : null;
  function report(err) {
    if (err.status === 401) callbacks.current.onExpired();
    else callbacks.current.notify(err.message || 'Unable to reach the server.', '!');
  }
  function merge(id, messages) {
    setChats(cs => cs.map(c => c.id === id ? {...c,
      messages:mergeMessages(c.messages ?? [], messages),
      lastMessage: [...messages, c.lastMessage].filter(Boolean).sort((a,b)=>b.seq-a.seq)[0],
    } : c));
  }
  async function refresh(token) {
    const { conversations } = await getConversations();
    if (scope.current !== token) return;
    setChats(cs => conversations.map(c => {
      const old = cs.find(item=>item.id===c.id);
      return {...c, lastMessage: old?.lastMessage?.seq > (c.lastMessage?.seq ?? 0) ? old.lastMessage : c.lastMessage,
        messages:old?.messages ?? [], hasMore:old?.hasMore};
    }));
    setError('');
  }
  useEffect(() => {
    setChats([]); setDrafts({}); setError(''); setLoadingOlder(false); setLoading(false);
    if (!user) return;
    const token = {userId:user.id}; scope.current = token;
    try {
      const saved=JSON.parse(sessionStorage.getItem(key) || '{}');
      if(saved && typeof saved==='object' && !Array.isArray(saved))
        setDrafts(Object.fromEntries(Object.entries(saved).filter(([,value])=>typeof value==='string')));
    } catch { /* Storage can be disabled. */ }
    setLoading(true);
    const socket = io({transports:['websocket']});
    const failed = err => { if (scope.current === token) report(err); };
    const reload = () => refresh(token).catch(err=>{
      if (scope.current === token) { setError(err.message); failed(err); }
    }).finally(()=>{ if (scope.current === token) setLoading(false); });
    socket.on('connect', () => { setNetwork('online'); reload(); });
    socket.on('disconnect', reason => {
      setNetwork(navigator.onLine ? 'reconnecting' : 'offline');
      if (reason === 'io server disconnect') getMe().then(()=>{if(scope.current===token)socket.connect();}, failed);
    });
    socket.on('connect_error', () => {
      setNetwork(navigator.onLine ? 'reconnecting' : 'offline');
      getMe().catch(failed);
    });
    socket.on('message:created', message => {
      // Refresh also discovers conversations started by another member.
      refresh(token).then(()=>{ if (scope.current === token) merge(message.conversationId,[message]); }).catch(failed);
    });
    reload();
    return () => { scope.current = null; socket.disconnect(); };
  }, [user?.id]);
  useEffect(() => {
    if (!user || !active) return;
    const token = scope.current; let cancelled = false;
    getMessages(active).then(page => {
      if (cancelled || scope.current !== token) return;
      setChats(cs=>cs.map(c=>c.id===active ? {...c,messages:mergeMessages(c.messages??[],page.messages),hasMore:page.hasMore} : c));
    }).catch(err=>{ if (!cancelled && scope.current===token) report(err); });
    return ()=>{ cancelled=true; };
  }, [user?.id,active]);
  function setDraft(value) {
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
    setDraft(''); transmit(active,message);
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
  function clearDrafts() { try { sessionStorage.removeItem(key); } catch { /* Storage can be disabled. */ } }
  const owned=scope.current?.userId===user?.id;
  return {chats:owned ? chats.map(c=>viewConversation(c,user?.id)) : [],draft:owned ? drafts[active]??'' : '',setDraft,send,retry,direct,older,loading,loadingOlder,network,error,
    reload:()=>refresh(scope.current).catch(report),clearDrafts};
}
