import { useEffect, useRef, useState } from 'react';
import { getAnonymousState, setAnonymousMode, sendAnonymousMessage } from './services/api.js';
import { mergeMessages, viewConversation } from './services/chat-model.js';
import { messageBodyError } from './model.js';

// Temporary bodies and drafts live only in this tab's RAM, separate from live history.
export default function useAnonymousChat(user, active, notify, onExpired) {
  const [rooms, setRooms] = useState({});
  const current = useRef({}), scope = useRef(null), selection = useRef(active);
  const callbacks = useRef({notify,onExpired});
  callbacks.current = {notify,onExpired}; selection.current = active;
  function write(id, room) {
    current.current = {...current.current, [id]:room};
    setRooms(current.current);
  }
  function clear() { current.current = {}; setRooms({}); }
  function apply(state) {
    const old = current.current[state.conversationId];
    if (old && state.version < old.state.version) return;
    if(state.expiresAt && Date.parse(state.expiresAt)<=Date.now())state={...state,status:'inactive'};
    const same = state.status === 'active' && old?.state.sessionId === state.sessionId;
    write(state.conversationId, {state, messages:same ? old.messages : [], draft:same ? old.draft : ''});
  }
  function report(err) {
    if (err.status === 401) { clear(); callbacks.current.onExpired(); }
    else callbacks.current.notify(err.message || 'Temporary chat is unavailable.', '!');
  }
  async function refresh(id = selection.current) {
    const token = scope.current;
    if (!id || !token) return;
    try {
      const {state} = await getAnonymousState(id);
      if (scope.current === token) apply(state);
    } catch (err) {
      if (scope.current !== token) return;
      // Group selection uses the same hook, but temporary controls are DM-only.
      if (err.code !== 'direct_only' && err.status !== 404) report(err);
    }
  }
  useEffect(() => {
    clear();
    scope.current = user ? {} : null;
    return () => { scope.current = null; current.current = {}; };
  }, [user?.id]);
  useEffect(() => { refresh(active); }, [user?.id,active]);
  useEffect(() => {
    // Clear locally at the deadline even when the server's ending push is unavailable.
    const timers=Object.values(rooms).filter(r=>r.state.status!=='inactive').map(({state})=>setTimeout(()=>{
      if(current.current[state.conversationId]?.state.version===state.version)apply({...state,status:'inactive'});
    },Math.max(0,Date.parse(state.expiresAt)-Date.now())));
    return ()=>timers.forEach(clearTimeout);
  },[rooms]);
  function receive(event, payload) {
    if (!scope.current) return;
    if (event === 'disconnect') {
      // Invalidate pending HTTP replies as well as messages, so reconnect cannot restore them.
      scope.current = {}; clear();
    } else if (event === 'connect') refresh();
    else if (event === 'state') apply(payload);
    else if (event === 'message') merge(payload);
  }
  function merge(message) {
    const room = current.current[message.conversationId];
    if (room?.state.status !== 'active' || room.state.sessionId !== message.sessionId) return;
    // shortcut: show the latest 200 temporary messages; no history recovery in this mode.
    write(message.conversationId, {...room, messages:mergeMessages(room.messages,[message]).slice(-200)});
  }
  async function action(action) {
    const token=scope.current, id=active, state=current.current[id]?.state;
    if (!token || !state) return;
    try {
      const result=await setAnonymousMode(id,action,state.status==='active'?state.sessionId:state.requestId);
      if(scope.current===token) apply(result.state);
    } catch(err) { if(scope.current===token){report(err);refresh(id);} }
  }
  function setDraft(draft) {
    const room=current.current[active];
    if(room?.state.status==='active') write(active,{...room,draft});
  }
  async function transmit(message) {
    const token=scope.current;
    merge({...message,status:'sending'});
    try {
      const result=await sendAnonymousMessage(message.conversationId, {
        sessionId:message.sessionId,clientMessageId:message.clientMessageId,body:message.body,
      });
      if(scope.current===token) merge(result.message);
    } catch(err) {
      if(scope.current!==token)return;
      const room=current.current[message.conversationId];
      if(room?.state.sessionId!==message.sessionId)return;
      write(message.conversationId,{...room,messages:room.messages.map(m=>
        m.clientMessageId===message.clientMessageId && !m.seq ? {...m,status:'failed'} : m)});
      report(err);
      if(err.code==='stale_session'||err.code==='peer_offline')refresh(message.conversationId);
    }
  }
  function send() {
    const room=current.current[active];
    if(room?.state.status!=='active')return callbacks.current.notify('Temporary session ended. Nothing was saved.','!');
    const body=room.draft.trim(), error=messageBodyError(body);
    if(error)return callbacks.current.notify(error,'!');
    const id=crypto.randomUUID();
    setDraft('');
    transmit({id,conversationId:active,sessionId:room.state.sessionId,clientMessageId:id,
      senderId:user.id,body,kind:'text',createdAt:new Date().toISOString()});
  }
  function retry(id) {
    const message=current.current[active]?.messages.find(m=>m.id===id);
    if(message?.status==='failed')transmit(message);
  }
  const room=rooms[active], temporary=room?.state.status==='active';
  const chat=temporary ? {...viewConversation({id:active,type:'direct',messages:room.messages,hasMore:false},user?.id),temporary:true} : null;
  return {receive,action,refresh,state:room?.state,ready:!!room,temporary,chat,draft:room?.draft??'',setDraft,send,retry};
}
