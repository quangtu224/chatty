import { useEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import Chat from './components/Chat.jsx';
import Auth from './components/Auth.jsx';
import { Brand } from './components/UI.jsx';
import { ConversationDialog, ProfileDialog, DetailsDialog, AddMembersDialog, ConfirmDialog } from './components/Dialogs.jsx';
import { readStorage, saveStorage } from './model.js';
import { getMe, logout, updateMe } from './services/api.js';
import useLiveChat from './useLiveChat.js';
import useAnonymousChat from './useAnonymousChat.js';
import AnonymousControls from './components/AnonymousControls.jsx';

export default function App() {
  const [theme,setTheme]=useState(()=>readStorage('chatty.theme.v1','light'));
  const [mode,setMode]=useState('checking'),[user,setUser]=useState(null);
  const [active,setActive]=useState(null),[mobileChat,setMobileChat]=useState(false);
  const [search,setSearch]=useState(''),[modal,setModal]=useState(null),[confirmation,setConfirmation]=useState(null),[toast,setToast]=useState('');
  const toastTimer=useRef(null);
  function notify(text,icon='✓') {
    clearTimeout(toastTimer.current);setToast(`${icon} ${text}`);
    toastTimer.current=setTimeout(()=>setToast(''),2800);
  }
  function endSession() {
    setUser(null);setMode('auth');setModal(null);setConfirmation(null);setActive(null);setMobileChat(false);setSearch('');
  }
  const anonymous=useAnonymousChat(mode==='live'?user:null,active,notify,endSession);
  const liveChat=useLiveChat(mode==='live'?user:null,active,notify,endSession,(id,name)=>{
    if(active===id){setActive(null);setMobileChat(false);setModal(null);setConfirmation(null);}
    notify(`You’re no longer in ${name}.`,'!');
  },anonymous.receive);
  const chat=liveChat.chats.find(c=>c.id===active);
  const temporary=chat?.type==='direct'&&anonymous.temporary;
  const profile=user ? {name:user.displayName,avatar:user.avatarId} : null;
  useEffect(()=>()=>clearTimeout(toastTimer.current),[]);
  useEffect(()=>{document.documentElement.dataset.theme=theme;saveStorage('chatty.theme.v1',theme);},[theme]);
  useEffect(()=>{
    let cancelled=false;
    getMe().then(({user})=>{if(!cancelled){setUser(user);setMode('live');}},()=>{if(!cancelled)setMode('auth');});
    return ()=>{cancelled=true;};
  },[]);
  useEffect(()=>{
    function shortcut(e){if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)&&!modal){e.preventDefault();document.querySelector('[aria-label="Search conversations"]')?.focus();}}
    document.addEventListener('keydown',shortcut);return ()=>document.removeEventListener('keydown',shortcut);
  },[modal]);
  function select(id){setActive(id);setMobileChat(true);}
  const themeToggle=()=>setTheme(t=>t==='light'?'dark':'light');
  const attempt=(request,success)=>request.then(()=>success&&notify(success),err=>notify(err.message,'!'));
  async function direct(person){const id=await liveChat.direct(person);if(id){select(id);setModal(null);}}
  async function group(name,members){const id=await liveChat.group(name,members);if(id){select(id);setModal(null);notify('Your little workspace is ready.');}}
  function transfer(id){
    const person=chat.people.find(p=>p.id===id);
    setConfirmation({title:'Make them the owner?',text:`${person.name} will manage ${chat.name}. You’ll stay as a member.`,action:()=>attempt(liveChat.transfer(chat.id,id),'Ownership transferred.')});
  }
  function remove(id){
    const person=chat.people.find(p=>p.id===id);
    setConfirmation({title:'Remove this teammate?',text:`${person.name} will no longer be part of ${chat.name}.`,action:()=>attempt(liveChat.remove(chat.id,id),'Member removed.')});
  }
  function leave(){
    const id=chat.id;
    setConfirmation({title:'Leave this group?',text:`You’ll leave ${chat.name}.`,action:()=>attempt(liveChat.leave(id).then(()=>{setActive(current=>current===id?null:current);setMobileChat(false);setModal(null);}),'You left the group.')});
  }
  if(mode==='checking')return null;
  if(mode==='auth')return <Auth onLive={u=>{setUser(u);setMode('live');setActive(null);}} />;
  return <div className={`workspace ${mobileChat?'show-chat':''}`}>
    <Sidebar chats={liveChat.chats} active={active} onSelect={select} search={search} setSearch={setSearch}
      roomVersion={liveChat.roomVersion} onJoin={async id=>{const joined=await liveChat.join(id);if(joined)select(joined);}}
      onNew={()=>setModal('new')} profile={profile} theme={theme} onTheme={themeToggle} onProfile={()=>setModal('profile')}
      onLogout={async()=>{try{await logout();}catch{return notify('We couldn’t sign you out. Try again.','!');}liveChat.clearDrafts();endSession();}} />
    {liveChat.error&&<div role="alert" className="network-banner">{liveChat.error}<button onClick={liveChat.reload}>Retry loading conversations</button></div>}
    {liveChat.loading?<main className="chat-main loading-screen"><Brand/><div className="loading-bars"><i/><i/><i/></div><p>Making room for your conversations…</p></main>
      :<Chat key={`${chat?.id||'empty'}:${temporary?'temporary':'normal'}`} chat={temporary?anonymous.chat:chat} profile={profile}
        draft={temporary?anonymous.draft:liveChat.draft} onDraft={temporary?anonymous.setDraft:liveChat.setDraft}
        onSend={temporary?anonymous.send:()=>liveChat.send()} onRetry={temporary?anonymous.retry:liveChat.retry} onGifSend={liveChat.send}
        onReloadHistory={liveChat.reloadHistory} onReadLatest={temporary?undefined:liveChat.markRead}
        visible={mobileChat} onBack={()=>setMobileChat(false)} onDetails={temporary?undefined:()=>setModal('details')} onOlder={liveChat.older}
        loadingOlder={liveChat.loadingOlder} network={liveChat.network} typing={temporary?[]:chat?.typingPeople}
        sendDisabled={chat?.type==='direct'&&(!anonymous.ready||liveChat.network!=='online')}
        controls={chat?.type==='direct'&&<AnonymousControls state={anonymous.state} userId={user.id} onAction={anonymous.action} onRefresh={anonymous.refresh} online={liveChat.network==='online'}/>}/>
    }
    {modal==='new'&&<ConversationDialog onClose={()=>setModal(null)} onDirect={direct} onGroup={group}/>}
    {modal==='profile'&&<ProfileDialog profile={profile} onClose={()=>setModal(null)} theme={theme} onTheme={themeToggle}
      onSave={async p=>{setUser((await updateMe({displayName:p.name,avatarId:p.avatar})).user);setModal(null);notify('Looking good. Profile updated.');}}/>}
    {modal==='details'&&chat&&!confirmation&&<DetailsDialog chat={chat} profile={profile} onClose={()=>setModal(null)} onMembers={()=>setModal('members')} onRemove={remove} onLeave={leave} onTransfer={transfer}/>}
    {modal==='members'&&chat&&<AddMembersDialog chat={chat} onClose={()=>setModal('details')} onAdd={async ids=>{await liveChat.add(chat.id,ids);setModal('details');notify('A few more minds in the room.');}}/>}
    {confirmation&&<ConfirmDialog title={confirmation.title} text={confirmation.text} onClose={()=>setConfirmation(null)} onConfirm={()=>{confirmation.action();setConfirmation(null);}}/>}
    {toast&&<div className="toast-message" role="status">{toast}</div>}
  </div>;
}
