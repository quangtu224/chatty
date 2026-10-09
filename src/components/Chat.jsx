import { useEffect, useRef, useState, useLayoutEffect } from "react";
import {
  ArrowLeft,
  ArrowDown,
  Send,
  Info,
  Pin,
  Check,
  AlertCircle,
  RotateCw,
  LoaderCircle,
} from "lucide-react";
import { Avatar, IconButton, EmptyState, SafeText } from "./UI.jsx";
import { people } from "../data.js";
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
}) {
  const history = useRef(null),
    bottom = useRef(null),
    preserve = useRef(null),
    textarea = useRef(null),
    skipScroll = useRef(false);
  const [away, setAway] = useState(false);
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
  }, [chat?.messages.length, typing]);
  if (!chat)
    return (
      <main className="chat-main">
        <EmptyState title="Make room for a good conversation.">
          Pick a chat from the sidebar, or start something new.
        </EmptyState>
      </main>
    );
  const online = chat.members.filter(
    (id) => id !== "me" && people.find((p) => p.id === id)?.online,
  ).length;
  const submit = () => {
    if (draft.trim()) {
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
            <i className={online ? "status-online" : "status-offline"} />
            {chat.type === "group"
              ? `${chat.members.length} members · ${online} online`
              : online
                ? "Online · Here to chat"
                : "Offline · Back soon"}
          </p>
        </div>
        <button
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
        </button>
      </header>
      {network !== "online" && (
        <div className="network-banner" role="status">
          <AlertCircle size={16} />
          {network === "offline"
            ? "You’re offline. Your draft is safe; messages can be retried when you reconnect."
            : "Reconnecting… Getting the conversation back on track."}
        </div>
      )}
      {chat.type === "group" && (
        <div className="topic-banner">
          <Pin size={16} />
          <span>{chat.description}</span>
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
          {!chat.olderLoaded ? (
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
            <span>You’re at the beginning of this conversation.</span>
          )}
        </div>
        {chat.messages.some((m) => m.older) && (
          <div className="date-divider">
            <span>Yesterday, October 7</span>
          </div>
        )}
        {chat.messages.length === 0 ? (
          <EmptyState title="A fresh start.">
            Say hello. Great things start with a small conversation.
          </EmptyState>
        ) : (
          chat.messages.map((m, i) => {
            const person =
              m.author === "me"
                ? profile
                : people.find((p) => p.id === m.author) || people[1];
            const outgoing = m.author === "me";
            const grouped =
              i > 0 &&
              chat.messages[i - 1].author === m.author &&
              !m.unreadStart &&
              chat.messages[i - 1].older === m.older;
            return (
              <div key={m.id}>
                {((i === 0 && !m.older) ||
                  (m.older !== chat.messages[i - 1]?.older && !m.older)) && (
                  <div className="date-divider">
                    <span>Today, October 8</span>
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
                        <time>{m.time}</time>
                      </div>
                    )}
                    <div
                      className={`message-bubble ${m.code ? "code-bubble" : ""}`}
                    >
                      {m.code ? (
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
        <div className="typing" aria-live="polite">
          {typing && (
            <>
              <Avatar name="fox" size={23} />
              <span>Alice is typing</span>
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
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
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
            disabled={!draft.trim()}
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
