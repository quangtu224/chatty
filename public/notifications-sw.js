// Notifications only: no fetch handler, offline cache or stored chat content.
const views=new Map(),seen=new Set();
let queue=Promise.resolve();
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
  const data=event.data??{};
  if(data.type==='view'){views.set(event.source.id,data);return;}
  // Serialize notifications from different tabs; the bounded dedup set lives only in RAM.
  const job=queue.catch(()=>{}).then(async()=>{
    if(data.type==='clear'){
      for(const n of await self.registration.getNotifications())
        if(n.data?.accountId===data.accountId&&(!data.conversationId||n.data.conversationId===data.conversationId)&&
          (!data.temporaryOnly||n.data.temporary||n.data.invitation))n.close();
      return;
    }
    if(data.type!=='notify')return;
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const id of views.keys())if(!clients.some(c=>c.id===id))views.delete(id);
    const source=clients.find(c=>c.id===event.source.id),view=source&&views.get(source.id);
    if(!view?.enabled||view.accountId!==data.accountId)return;
    const key=`${data.accountId}:${data.eventId}`;
    if(seen.has(key))return;
    seen.add(key);if(seen.size>200)seen.delete(seen.values().next().value);
    if(clients.some(c=>c.focused&&c.visibilityState==='visible'&&views.get(c.id)?.accountId===data.accountId&&
      views.get(c.id)?.conversationId===data.conversationId))return;
    const {accountId,conversationId,sessionId,eventId,temporary,invitation}=data;
    const name=typeof data.senderName==='string'?data.senderName.slice(0,40):'Chatty';
    const title=invitation?`${name} · Temporary invitation`:temporary?`${name} · Temporary chat`:
      data.roomName?`${name} · ${data.roomName}`:name;
    const tag=`chatty:${accountId}:${conversationId}`;
    await self.registration.showNotification(title,{
      body:invitation?'Invited you to a temporary chat':temporary?'New temporary message':
        typeof data.body==='string'?data.body.slice(0,200):'You have a new message',
      tag,icon:'/avatars/owl.svg',requireInteraction:true,
      data:{accountId,conversationId,sessionId,eventId,temporary,invitation},
    });
    return {tag,eventId};
  });
  queue=job;
  // Keep the worker alive for this deadline without blocking the next notification.
  event.waitUntil(job.then(async notice=>{
    if(!notice)return;
    await new Promise(resolve=>setTimeout(resolve,15000));
    for(const n of await self.registration.getNotifications({tag:notice.tag}))
      if(n.data?.eventId===notice.eventId)n.close(); // An older timer must not close its replacement.
  }).catch(()=>{}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const data=event.notification.data,clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=clients.find(c=>views.get(c.id)?.accountId===data.accountId);
    if(client){await client.focus();client.postMessage({type:'open-conversation',...data});}
    else await self.clients.openWindow('/');
  })());
});
