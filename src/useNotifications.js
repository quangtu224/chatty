import {useEffect,useRef,useState} from 'react';
import {readStorage,saveStorage} from './model.js';

// Only live socket events trigger notifications; no polling or closed-app Web Push.
export default function useNotifications(user,conversationId,onOpen,notify){
  const supported=typeof Notification!=='undefined'&&'serviceWorker' in navigator&&window.isSecureContext;
  const [enabled,setEnabled]=useState(false),[permission,setPermission]=useState(supported?Notification.permission:'unsupported');
  const registration=useRef(null),current=useRef({});
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
    return ()=>{cancelled=true;post({type:'clear',accountId});post({type:'view',accountId:null,enabled:false});registration.current=null;
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
  function incoming(type,payload){
    if(!user)return;
    if(type==='anonymous:state'){
      if(payload.status!=='pending')post({type:'clear',accountId:user.id,conversationId:payload.conversationId,temporaryOnly:true});
      if(payload.status!=='pending'||payload.requestedBy===user.id||Date.parse(payload.expiresAt)<=Date.now())return;
    }else if(payload.senderId===user.id)return;
    if(!enabled||permission!=='granted')return;
    view();post({type:'notify',accountId:user.id,conversationId:payload.conversationId,
      eventId:type==='anonymous:state'?payload.requestId:payload.id,sessionId:payload.sessionId,
      temporary:type==='anonymous:message',invitation:type==='anonymous:state'});
  }
  return {toggle,incoming,enabled:enabled&&permission==='granted',supported:permission!=='unsupported'};
}
