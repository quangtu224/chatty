import {useEffect,useRef,useState} from 'react';
import {readStorage,saveStorage} from './model.js';
import {getConversation} from './services/api.js';

// Only live socket events trigger notifications; no polling or closed-app Web Push.
export default function useNotifications(user,conversationId,onOpen,notify){
  const supported=typeof Notification!=='undefined'&&'serviceWorker' in navigator&&window.isSecureContext;
  const [enabled,setEnabled]=useState(false),[permission,setPermission]=useState(supported?Notification.permission:'unsupported');
  const registration=useRef(null),current=useRef({}),pendingInvitations=useRef(new Map());
  current.current={user,conversationId,onOpen,notify,enabled};
  function post(data){registration.current?.active?.postMessage(data);}
  function view(){const c=current.current;post({type:'view',accountId:c.user?.id??null,conversationId:c.conversationId,enabled:c.enabled});}
  useEffect(()=>{
    if(!supported||!user)return;
    let cancelled=false;const accountId=user.id;
    setEnabled(readStorage(`chatty.notifications.${accountId}`,false)===true&&Notification.permission==='granted');
    navigator.serviceWorker.register('/notifications-sw.js').then(()=>navigator.serviceWorker.ready).then(reg=>{
      if(!cancelled){registration.current=reg;view();}
    }).catch(()=>{if(!cancelled)setPermission('unsupported');});
    function open(event){if(event.source?.scriptURL!==new URL('/notifications-sw.js',location.origin).href)return;
      const data=event.data;if(data?.type==='open-conversation'&&data.accountId===current.current.user?.id)current.current.onOpen(data.conversationId);}
    navigator.serviceWorker.addEventListener('message',open);
    function focus(){setPermission(Notification.permission);view();}
    function preference(event){if(event.key===`chatty.notifications.${accountId}`)
      setEnabled(readStorage(event.key,false)===true&&Notification.permission==='granted');}
    window.addEventListener('focus',focus);
    window.addEventListener('storage',preference);
    return ()=>{cancelled=true;pendingInvitations.current.clear();post({type:'clear',accountId});post({type:'view',accountId:null,enabled:false});registration.current=null;
      navigator.serviceWorker.removeEventListener('message',open);window.removeEventListener('focus',focus);window.removeEventListener('storage',preference);};
  },[user?.id,supported]);
  useEffect(()=>{view();},[conversationId,enabled]);
  async function toggle(){
    const accountId=user?.id;if(!accountId||!supported)return;
    if(enabled&&Notification.permission==='granted'){setEnabled(false);saveStorage(`chatty.notifications.${accountId}`,false);post({type:'clear',accountId});return;}
    try{
      const allowed=Notification.permission==='default'?await Notification.requestPermission():Notification.permission;
      if(current.current.user?.id!==accountId)return;
      setPermission(allowed);
      if(allowed==='granted'){saveStorage(`chatty.notifications.${accountId}`,true);setEnabled(true);}
      else notify('Notifications are blocked. Allow them in your browser’s site settings.','!');
    }catch{notify('Notifications are unavailable in this browser.','!');}
  }
  async function incoming(type,payload,chat){
    if(!user)return;
    if(type==='anonymous:state'){
      pendingInvitations.current.set(payload.conversationId,payload.status==='pending'?payload.requestId:null);
      if(payload.status!=='pending')post({type:'clear',accountId:user.id,conversationId:payload.conversationId,temporaryOnly:true});
      if(payload.status!=='pending'||payload.requestedBy===user.id||Date.parse(payload.expiresAt)<=Date.now())return;
    }else if(payload.senderId===user.id)return;
    if(!enabled||permission!=='granted')return;
    const accountId=user.id,senderId=payload.senderId??payload.requestedBy;
    const sender=conversation=>conversation?.peer?.id===senderId?conversation.peer:
      (conversation?.people??conversation?.members??conversation?.readers)?.find(p=>p.id===senderId);
    let person=sender(chat);
    // A first message can arrive before the conversation list; fetch only authorized metadata.
    if(!person){try{chat=(await getConversation(payload.conversationId)).conversation;person=sender(chat);}catch{return;}}
    if(current.current.user?.id!==accountId||!current.current.enabled||Notification.permission!=='granted')return;
    // Metadata may resolve after the invitation was accepted, cancelled or expired.
    if(type==='anonymous:state'&&(pendingInvitations.current.get(payload.conversationId)!==payload.requestId||Date.parse(payload.expiresAt)<=Date.now()))return;
    view();post({type:'notify',accountId:user.id,conversationId:payload.conversationId,
      eventId:type==='anonymous:state'?payload.requestId:payload.id,sessionId:payload.sessionId,
      senderName:person?.displayName??person?.name??'Someone',roomName:chat?.type==='group'?chat.name:undefined,
      body:type==='message:created'?(payload.kind==='gif'?'Sent a GIF':payload.body.slice(0,200)):'',
      temporary:type==='anonymous:message',invitation:type==='anonymous:state'});
  }
  return {toggle,incoming,enabled:enabled&&permission==='granted',supported:permission!=='unsupported'};
}
