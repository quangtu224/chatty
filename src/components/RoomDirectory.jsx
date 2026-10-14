import {useEffect,useState} from 'react';
import {getGroups} from '../services/api.js';
import {Avatar} from './UI.jsx';

// Catalog rows expose no message previews; Join fetches authorized chat details.
export default function RoomDirectory({search,version,onJoin,active}){
  const [rooms,setRooms]=useState([]),[cursor,setCursor]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(null),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let cancelled=false;setLoading(true);setError('');
    const timer=setTimeout(()=>getGroups(search).then(result=>{if(!cancelled){setRooms(result.groups);setCursor(result.nextCursor);}}).catch(err=>{if(!cancelled)setError(err.message);}).finally(()=>{if(!cancelled)setLoading(false);}),200);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[search,version,retry]);
  async function more(){setLoading(true);try{const result=await getGroups(search,cursor);setRooms(rows=>[...rows,...result.groups.filter(r=>!rows.some(old=>old.id===r.id))]);setCursor(result.nextCursor);}catch(err){setError(err.message);}finally{setLoading(false);}}
  return <section aria-label="All public rooms">
    <div className="section-label">All rooms <button className="text-button" onClick={()=>setRetry(n=>n+1)}>Refresh</button></div>
    {rooms.map(room=><button key={room.id} className={`conversation-row ${active===room.id?'selected':''}`} disabled={busy!==null||(!room.isMember&&room.memberCount>=20)}
      onClick={async()=>{setBusy(room.id);setError('');try{await onJoin(room.id);setRetry(n=>n+1);}catch(err){setError(err.message);}finally{setBusy(null);}}}>
      <Avatar name="forest" size={42}/><div className="conversation-copy"><div className="conversation-title"><strong># {room.name}</strong></div>
      <div className="preview-line"><span>{room.memberCount}/20 members · {busy===room.id?'Joining…':room.isMember?'Open':room.memberCount>=20?'Full':'Join'}</span></div></div>
    </button>)}
    {loading&&<p role="status" className="dialog-description">Loading rooms…</p>}
    {!loading&&!rooms.length&&!error&&<p className="dialog-description">No rooms yet. Create one to get started.</p>}
    {error&&<p role="alert" className="field-error">{error} <button className="text-button" onClick={()=>setRetry(n=>n+1)}>Retry</button></p>}
    {cursor&&<button className="text-button" disabled={loading} onClick={more}>Load more rooms</button>}
  </section>;
}
