import express from 'express';
import {randomUUID} from 'node:crypto';
import {UUID} from './conversations.js';
import {sendError} from './auth.js';
import {messageBodyError} from '../src/model.js';
const deny=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};

// One-process, memory-only sessions. No consent or temporary message is written to SQL.
export function createAnonymous({pool,auth,limit,isOnline,onState,onMessage,requestTtl=60_000,sessionTtl=30*60_000}){
  const sessions=new Map(),queues=new Map();let version=0,closed=false;
  // Consent transitions and durable/temporary sends share this queue to prevent accidental storage.
  function run(id,work){
    const job=(queues.get(id)??Promise.resolve()).catch(()=>{}).then(()=>{if(closed)deny(503,'temporary_unavailable','Temporary chat is unavailable.');return work();});
    queues.set(id,job);return job.finally(()=>{if(queues.get(id)===job)queues.delete(id);});
  }
  const inactive=id=>({conversationId:id,status:'inactive',version:++version,requestId:null,sessionId:null,requestedBy:null,expiresAt:null,readers:[]});
  const publicState=s=>({conversationId:s.id,status:s.status,version:s.version,requestId:s.requestId,sessionId:s.sessionId,requestedBy:s.requestedBy,expiresAt:s.expiresAt,
    readers:s.members.map(userId=>({userId,lastReadSeq:s.reads.get(userId)??0}))});
  async function members(id,userId){
    if(!UUID.test(id))deny(404,'not_found','Conversation not found.');
    const {rows}=await pool.query('SELECT c.type,cm.user_id FROM chatty.conversations c JOIN chatty.conversation_members cm ON cm.conversation_id=c.id WHERE c.id=$1',[id]);
    if(!rows.some(r=>r.user_id===userId))deny(404,'not_found','Conversation not found.');
    if(rows[0].type!=='direct'||rows.length!==2)deny(409,'direct_only','Anonymous mode is available only in direct messages.');
    return rows.map(r=>r.user_id);
  }
  async function publish(state,users){try{await onState(state,users);}catch{console.error({code:'temporary_state_push_failed'});}}
  async function end(id){
    const old=sessions.get(id);if(!old)return inactive(id);
    clearTimeout(old.timer);sessions.delete(id);old.messages.clear();old.reads.clear();
    const state=inactive(id);await publish(state,old.members);return state;
  }
  function schedule(s,ttl){
    s.expiresAt=new Date(Date.now()+ttl).toISOString();
    s.timer=setTimeout(()=>run(s.id,()=>sessions.get(s.id)===s?end(s.id):null).catch(()=>{}),ttl);s.timer.unref();
  }
  function assertOnline(users){if(!users.every(isOnline))deny(409,'peer_offline','Both people must be connected for a temporary session.');}
  const router=express.Router();router.use('/conversations/:id/anonymous',auth,(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  function route(work){return async(req,res)=>{try{await run(req.params.id,async()=>{
    // Enforce the deadline even if a busy event loop has delayed the expiry timer.
    const s=sessions.get(req.params.id);if(s&&Date.parse(s.expiresAt)<=Date.now())await end(s.id);
    await work(req,res);
  });}catch(err){if(err.status)return sendError(req,res,err.status,err.code,err.message);throw err;}};}
  router.get('/conversations/:id/anonymous',route(async(req,res)=>{
    await members(req.params.id,req.user.id);const s=sessions.get(req.params.id);
    res.set('Cache-Control','no-store').json({state:s?publicState(s):inactive(req.params.id)});
  }));
  router.post('/conversations/:id/anonymous',limit,route(async(req,res)=>{
    const id=req.params.id,users=await members(id,req.user.id),{action,id:expected}=req.body??{};let s=sessions.get(id);
    if(action==='request'){
      assertOnline(users);
      if(s){if(s.status==='pending'&&s.requestedBy===req.user.id)return res.json({state:publicState(s)});deny(409,'session_exists','Respond to the current request or end the session first.');}
      s={id,members:users,status:'pending',requestId:randomUUID(),sessionId:null,requestedBy:req.user.id,version:++version,messages:new Map(),reads:new Map(),seq:0};sessions.set(id,s);schedule(s,requestTtl);
    }else{
      if(!['accept','decline','stop'].includes(action))deny(400,'validation_failed','Choose request, accept, decline or stop.');
      if(!s||expected!==(s.status==='active'?s.sessionId:s.requestId))deny(409,'stale_session','This request or session has ended.');
      if(action==='accept'){
        if(s.status!=='pending'||s.requestedBy===req.user.id)deny(409,'consent_required','The other person must explicitly accept.');
        assertOnline(users);clearTimeout(s.timer);s={...s,status:'active',sessionId:randomUUID(),version:++version};sessions.set(id,s);schedule(s,sessionTtl);
      }else return res.json({state:await end(id)});
    }
    const state=publicState(s);await publish(state,users);res.json({state});
  }));
  router.post('/conversations/:id/anonymous/messages',limit,route(async(req,res)=>{
    const id=req.params.id,users=await members(id,req.user.id),s=sessions.get(id),{sessionId,clientMessageId,body}=req.body??{};
    if(!s||s.status!=='active'||s.sessionId!==sessionId)deny(409,'stale_session','Temporary session ended. This message was not saved.');
    assertOnline(users);
    if(typeof clientMessageId!=='string'||!UUID.test(clientMessageId)||messageBodyError(body))deny(400,'validation_failed','Use a message ID and 1–4000 nonblank characters.');
    const key=`${req.user.id}:${clientMessageId}`,existing=s.messages.get(key);
    const record=existing??{message:{id:randomUUID(),conversationId:id,sessionId,clientMessageId,senderId:req.user.id,seq:++s.seq,kind:'text',body,gifId:null,createdAt:new Date().toISOString()},delivered:false};
    s.messages.set(key,record);
    // shortcut: keep 200 retry acknowledgements per temporary session; expand if older retries are needed.
    if(s.messages.size>200)s.messages.delete(s.messages.keys().next().value);
    if(!record.delivered){try{await onMessage(record.message,users);record.delivered=true;}catch{deny(503,'temporary_unavailable','Temporary delivery failed. Retry here; no permanent copy was created.');}}
    res.set('Cache-Control','no-store').status(existing?200:201).json({message:record.message});
  }));
  router.put('/conversations/:id/anonymous/read',route(async(req,res)=>{
    const id=req.params.id,users=await members(id,req.user.id),s=sessions.get(id),{sessionId,seq}=req.body??{};
    if(!s||s.status!=='active'||s.sessionId!==sessionId)deny(409,'stale_session','Temporary session ended.');
    assertOnline(users);
    if(!Number.isSafeInteger(seq)||seq<0||seq>s.seq)deny(400,'validation_failed','Use a read position within this temporary session.');
    // Temporary cursors belong to the session, never to persistent conversation_members.
    const previous=s.reads.get(req.user.id)??0;s.reads.set(req.user.id,Math.max(previous,seq));
    const state=publicState(s);if(seq>previous)await publish(state,users);res.json({state});
  }));
  return {router,run,isActive:id=>closed||sessions.get(id)?.status==='active',
    endForUser:userId=>Promise.all([...sessions.values()].filter(s=>s.members.includes(userId)).map(s=>run(s.id,()=>end(s.id)))),
    close(){closed=true;for(const s of sessions.values()){clearTimeout(s.timer);s.messages.clear();s.reads.clear();}sessions.clear();},
  };
}
