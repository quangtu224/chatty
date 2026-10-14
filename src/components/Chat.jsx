import { useEffect, useRef, useState, useLayoutEffect } from "react";
import {
  ArrowLeft,
  ArrowDown,
  Send,
  Info,
  Check,
  AlertCircle,
  RotateCw,
  LoaderCircle,
} from "lucide-react";
import { Avatar, IconButton, EmptyState, SafeText } from "./UI.jsx";
import GifPicker from './GifPicker.jsx';
import { gifUrl, typingText } from '../services/chat-model.js';
export default function Chat({
  chat,
  profile,
  draft,
  onDraft,
  onSend,
  onRetry,
  onBack,
  onDetails,
  onOlder,
  loadingOlder,
  network,
  typing,
  visible,
  onGifSend,
  onReloadHistory,
  onReadLatest,
  controls,
  sendDisabled,
}) {
  const history = useRef(null),
    bottom = useRef(null),
    preserve = useRef(null),
    textarea = useRef(null),
    skipScroll = useRef(false);
  const [away, setAway] = useState(false);
  const [gifDismissed,setGifDismissed]=useState(false);
  const gifCommand=!chat?.temporary && /^\/gif(?:\s|$)/.test(draft.trimStart()) ? draft.trimStart().slice(4).trim() : null;
  const gifQuery=gifDismissed ? null : gifCommand;
  useLayoutEffect(() => {
    preserve.current = null;
    skipScroll.current = false;
  }, [chat?.id]);
  useLayoutEffect(() => {
    if (preserve.current !== null && history.current) {
      history.current.scrollTop =
        history.current.scrollHeight - preserve.current;
      preserve.current = null;
      skipScroll.current = true;
    }
  }, [chat?.messages.length]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
    setAway(false);
  }, [chat?.id, visible]);
  useEffect(() => {
    if (skipScroll.current) {
      skipScroll.current = false;
      return;
    }
    if (!away && preserve.current === null)
      bottom.current?.scrollIntoView({ block: "end" });
  }, [chat?.messages.length, typing?.length]);
  // Live read receipts for myself: report "read up to the newest message" only while
  // this chat is really on screen (not hidden by the mobile layout), the browser tab is
  // visible and the history is scrolled to the bottom. Runs again when new messages
  // arrive, when scrolling back down and when the tab becomes visible.
  useEffect(() => {
    if (!onReadLatest) return;
    const check = () => {
      const shown = history.current?.getClientRects().length > 0;
      if (shown && !away && document.visibilityState === "visible") onReadLatest();
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [onReadLatest, chat?.id, chat?.messages.length, away, visible]);
  if (!chat)
    return (
      <main className="chat-main">
        <EmptyState title="Make room for a good conversation.">
          Pick a chat from the sidebar, or start something new.
        </EmptyState>
      </main>
    );
  const submit = () => {
    if (!sendDisabled && draft.trim()) {
      if (gifCommand!==null) {
        setGifDismissed(false);
        document.querySelector('.gif-picker .gif-result')?.focus();
        return;
      }
      setAway(false);
      onSend();
      textarea.current?.focus();
    }
  };
  return (
    <main className="chat-main">
      <header className="chat-header">
        <IconButton
          label="Back to conversations"
          className="icon-button mobile-back"
          onClick={onBack}
        >
          <ArrowLeft size={22} />
        </IconButton>
        <Avatar name={chat.avatar} size={52} />
        <div className="header-copy">
          <h1>
            {chat.type === "group" && <span># </span>}
            {chat.name}
          </h1>
          <p>
            {typeof chat.peer?.online==='boolean' && <i className={chat.peer.online ? "status-online" : "status-offline"} />}
            {chat.peer
              ? chat.peer.online===undefined ? 'Checking status…' : `${chat.peer.online ? "Online" : "Offline"} · @${chat.peer.handle}`
              : `${chat.memberCount} ${chat.memberCount === 1 ? "member" : "members"}${chat.people && chat.onlineCount!==null ? ` · ${chat.onlineCount} online` : ""}`}
          </p>
        </div>
        {onDetails && <button
          className="btn btn-outline-secondary details-button"
          aria-label={
            chat.type === "group" ? "Group details" : "Contact details"
          }
          onClick={onDetails}
        >
          <Info size={17} />
          <span>
            {chat.type === "group" ? "Group details" : "Contact details"}
          </span>
        </button>}
      </header>
      {controls}
      {network !== "online" && (
        <div className="network-banner" role="status">
          <AlertCircle size={16} />
          {network === "offline"
            ? "You’re offline. Your draft is safe; messages can be retried when you reconnect."
            : "Reconnecting… Getting the conversation back on track."}
        </div>
      )}
      <div
        className="message-history"
        ref={history}
        onScroll={() => {
          const e = history.current;
          setAway(e.scrollHeight - e.scrollTop - e.clientHeight > 120);
        }}
        role="log"
        aria-label="Message history"
      >
        <div className="older-area">
          {chat.historyError ? <div role="alert">{chat.historyError} <button className="text-button" onClick={onReloadHistory}>Retry loading messages</button></div>
          : chat.historyLoading ? <span role="status">Loading messages…</span> : !chat.olderLoaded ? (
            <button
              className="text-button"
              disabled={loadingOlder}
              onClick={() => {
                preserve.current =
                  history.current.scrollHeight - history.current.scrollTop;
                onOlder();
              }}
            >
              {loadingOlder ? (
                <>
                  <LoaderCircle size={13} className="spin" /> Loading older
                  messages…
                </>
              ) : (
                <>↑ Load earlier messages</>
              )}
            </button>
          ) : (
            <span>{chat.temporary ? 'Messages disappear when this session ends.' : 'You’re at the beginning of this conversation.'}</span>
          )}
        </div>
        {chat.messages.length === 0 ? (
          <EmptyState title="A fresh start.">
            Say hello. Great things start with a small conversation.
          </EmptyState>
        ) : (
          chat.messages.map((m, i) => {
            const person =
              m.author === "me"
                ? profile
                : chat.peer ?? chat.people?.find((p) => p.id === m.author) ??
                    { name: chat.people ? "Former member" : "Member", avatar: "forest" };
            const outgoing = m.author === "me";
            const grouped =
              i > 0 &&
              chat.messages[i - 1].author === m.author &&
              !m.unreadStart &&
              chat.messages[i - 1].date === m.date;
            return (
              <div key={m.id}>
                {(i === 0 || m.date !== chat.messages[i - 1]?.date) && (
                  <div className="date-divider">
                    <span>{m.date}</span>
                  </div>
                )}
                {m.unreadStart && (
                  <div className="unread-divider">
                    <span>New messages</span>
                  </div>
                )}
                <article
                  className={`message ${outgoing ? "outgoing" : ""} ${grouped ? "grouped" : ""}`}
                >
                  <div className="message-avatar">
                    {!outgoing && !grouped && (
                      <Avatar name={person.avatar} size={38} />
                    )}
                  </div>
                  <div className="message-body">
                    {!grouped && (
                      <div className="message-meta">
                        {!outgoing && <strong>{person.name}</strong>}
                        <time dateTime={m.createdAt}>{m.time}</time>
                      </div>
                    )}
                    <div
                      className={`message-bubble ${m.code ? "code-bubble" : ""}`}
                    >
                      {m.kind === 'gif' && gifUrl(m.gifId) ? (
                        <><img className="message-gif" src={gifUrl(m.gifId)} alt={m.text} loading="lazy" referrerPolicy="no-referrer" />
                        <a className="giphy-attribution" href="https://giphy.com" target="_blank" rel="noreferrer">Powered by GIPHY</a></>
                      ) : m.code ? (
                        <code>{m.text}</code>
                      ) : (
                        <SafeText text={m.text} />
                      )}
                    </div>
                    {outgoing && (
                      <div
                        className={`message-status ${m.status}`}
                        aria-live="polite"
                      >
                        {m.status === "sending" ? (
                          <>
                            <LoaderCircle className="spin" size={12} /> Sending…
                          </>
                        ) : m.status === "failed" ? (
                          <>
                            <AlertCircle size={12} /> Not sent{" "}
                            <button onClick={() => onRetry(m.id)}>
                              <RotateCw size={11} /> Retry
                            </button>
                          </>
                        ) : (
                          <>
                            <Check size={12} /> Sent
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              </div>
            );
          })
        )}
        <div ref={bottom} />
      </div>
      {away && (
        <button
          className="jump-button btn"
          onClick={() => {
            bottom.current?.scrollIntoView({ block: "end" });
            setAway(false);
          }}
        >
          <ArrowDown size={15} /> Jump to latest
        </button>
      )}
      <footer className="composer-area">
        {gifQuery !== null && <GifPicker query={gifQuery} onCancel={()=>{setGifDismissed(true);textarea.current?.focus();}}
          onSelect={gif=>{setAway(false);onGifSend(gif);textarea.current?.focus();}} />}
        <div className="typing" aria-live="polite">
          {typing?.length > 0 && (
            <>
              <Avatar name={typing[0].avatar} size={23} />
              <span>{typingText(typing)}</span>
              <span className="typing-dots">•••</span>
            </>
          )}
        </div>
        <div className="composer">
          <textarea
            ref={textarea}
            aria-label={`Message ${chat.name}`}
            placeholder={`Message ${chat.name}…`}
            rows={2}
            value={draft}
            readOnly={sendDisabled}
            onChange={(e) => {setGifDismissed(false);onDraft(e.target.value);}}
            onKeyDown={(e) => {
              if(e.key==='Escape' && gifQuery!==null){e.preventDefault();setGifDismissed(true);return;}
              if(e.key==='ArrowDown' && gifQuery!==null && !e.nativeEvent.isComposing){
                const result=document.querySelector('.gif-picker .gif-result');if(result){e.preventDefault();result.focus();}return;
              }
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button
            className="send-button"
            aria-label="Send message"
            disabled={!draft.trim() || gifCommand !== null || sendDisabled}
            onClick={submit}
          >
            <Send size={21} />
          </button>
        </div>
        <div className="composer-hint">
          <span>
            <kbd>Enter</kbd> to send · <kbd>Shift + Enter</kbd> for a new line
          </span>
          <span>Good conversations. Better things built together.</span>
        </div>
      </footer>
    </main>
  );
}
