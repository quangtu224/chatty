import {Timer} from 'lucide-react';

export default function AnonymousControls({state,userId,peerName,onAction,online,onRefresh}) {
  const active=state?.status==='active',pending=state?.status==='pending',mine=state?.requestedBy===userId;
  const expiry=state?.expiresAt ? new Date(state.expiresAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
  return <section className={`anonymous-controls ${active?'is-active':''}`} aria-label="Anonymous DM controls">
    <div className="temporary-status" role="status">
      <span className="temporary-icon"><Timer size={18}/></span>
      <div><strong>{active?'Temporary chat is on':pending?'Temporary chat invitation':'Keep this conversation temporary'}</strong>
        <p>{!state?'Checking the session…':active?`Messages disappear when this session ends · ends at ${expiry}`
          :pending?mine?'Waiting for your contact to accept · expires in 60 seconds':`${peerName} invited you. Join only if you agree.`
          :'Same people, no saved history. Both of you choose when to start.'}</p>
      </div>
    </div>
    <div className="temporary-actions">
      {!state?<button className="text-button" onClick={()=>onRefresh()}>Refresh session</button>
        :active?<button className="btn btn-outline-secondary" aria-label="End temporary session" onClick={()=>onAction('stop')}>End session</button>
        :pending?<>
          {!mine&&<button className="btn btn-primary" aria-label="Accept temporary chat" disabled={!online} onClick={()=>onAction('accept')}>Accept</button>}
          <button className="btn btn-outline-secondary" onClick={()=>onAction('decline')}>{mine?'Cancel request':'Decline'}</button>
        </>:<button className="btn btn-outline-secondary" aria-label="Request anonymous DM" disabled={!online} onClick={()=>onAction('request')}>Go temporary</button>}
    </div>
    <details className="temporary-privacy">
      <summary>How temporary chat works</summary>
      <p>Both people must be online and agree. Text and drafts stay in memory for up to 30 minutes; they are never saved to the database or browser storage. Either person can end the session. Disconnecting clears this tab; losing either person's last connection ends it. Your normal history returns afterward. Names stay visible. This is not end-to-end encryption.</p>
    </details>
  </section>;
}
