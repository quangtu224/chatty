export default function AnonymousControls({state,userId,onAction,online,onRefresh}) {
  return <section className="anonymous-controls" aria-label="Anonymous DM controls">
    {!state ? <><span>Checking temporary session…</span><button className="text-button" onClick={()=>onRefresh()}>Refresh session</button></>
      : state.status==='active' ? <>
        <span><strong>Anonymous DM · temporary</strong> — text stays in memory for up to 30 minutes. Either person can end it.</span>
        <button className="btn btn-outline-secondary" onClick={()=>onAction('stop')}>End temporary session</button>
      </> : state.status==='pending' ? <>
        <span>{state.requestedBy===userId ? 'Waiting for the other person’s consent (60 seconds).' : 'Your contact requested a temporary anonymous DM. Accept only if you agree.'}</span>
        {state.requestedBy!==userId && <button className="btn btn-primary" disabled={!online} onClick={()=>onAction('accept')}>Accept temporary chat</button>}
        <button className="btn btn-outline-secondary" onClick={()=>onAction('decline')}>{state.requestedBy===userId?'Cancel request':'Decline'}</button>
      </> : <>
        <span>Temporary anonymous DM needs both people online and their consent.</span>
        <button className="btn btn-outline-secondary" disabled={!online} onClick={()=>onAction('request')}>Request anonymous DM</button>
      </>}
    <small>No database history or draft storage. Disconnecting clears this tab; either person losing their last connection ends the session. Normal history returns afterward. Your contact and server know who you are; this is not end-to-end encryption.</small>
  </section>;
}
