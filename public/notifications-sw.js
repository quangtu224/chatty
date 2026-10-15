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
    await self.registration.showNotification('Chatty',{
      body:invitation?'You received a temporary chat invitation':temporary?'New temporary message':'You have a new message',
      tag:`chatty:${accountId}:${conversationId}`,icon:'/avatars/owl.svg',
      data:{accountId,conversationId,sessionId,eventId,temporary,invitation},
    });
  });
  queue=job;event.waitUntil(job.catch(()=>{}));
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
