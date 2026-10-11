import { useEffect, useRef, useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import Chat from "./components/Chat.jsx";
import Auth from "./components/Auth.jsx";
import { Brand } from "./components/UI.jsx";
import {
  ConversationDialog,
  ProfileDialog,
  DetailsDialog,
  AddMembersDialog,
  ConfirmDialog,
  DemoDialog,
} from "./components/Dialogs.jsx";
import { initialConversations, people, olderMessages } from "./data.js";
import { readStorage, saveStorage, updateStatus } from "./model.js";
import { getMe, logout, updateMe } from "./services/api.js";
import useLiveChat from './useLiveChat.js';
export default function App() {
  const [chats, setChats] = useState(() =>
    readStorage("chatty.chats.v1", initialConversations).map((c) => ({
      ...c,
      unread: c.id === "workshop" ? 0 : c.unread,
      messages: c.messages.map((m) =>
        m.status === "sending" ? { ...m, status: "failed" } : m,
      ),
    })),
  );
  const [profile, setProfile] = useState(() =>
    readStorage("chatty.profile.v1", { name: "Alex Morgan", avatar: "cat" }),
  );
  const [theme, setTheme] = useState(() =>
    readStorage("chatty.theme.v1", "light"),
  );
  const [drafts, setDrafts] = useState(() =>
    readStorage("chatty.drafts.v1", {}),
  );
  // "checking" until GET /me answers; "live" = server session, "demo" = local fixtures.
  const [mode, setMode] = useState("checking"),
    [user, setUser] = useState(null);
  const [active, setActive] = useState("workshop"),
    [mobileChat, setMobileChat] = useState(false),
    [search, setSearch] = useState(""),
    [modal, setModal] = useState(null),
    [confirmation, setConfirmation] = useState(null),
    [network, setNetwork] = useState("online"),
    [failNext, setFailNext] = useState(false),
    [typing, setTyping] = useState(true),
    [loading, setLoading] = useState(true),
    [loadingOlder, setLoadingOlder] = useState(false),
    [toast, setToast] = useState("");
  const timers = useRef(new Set());
  const live = mode === "live";
  const liveChat = useLiveChat(live ? user : null, active, notify, () => {
    setUser(null); setMode('auth'); setModal(null); setActive(null);
  }, (id, name) => {
    // Removed from a group (or it was left in another tab): close it if it is open.
    // useLiveChat calls the latest callback, so `active` is current here.
    if (active === id) {
      setActive(null); setMobileChat(false); setModal(null); setConfirmation(null);
    }
    notify(`You’re no longer in ${name}.`, '!');
  });
  const shownChats = live ? liveChat.chats : chats;
  const shownProfile = live
    ? { name: user.displayName, avatar: user.avatarId }
    : profile;
  const chat = shownChats.find((c) => c.id === active);
  function later(fn, delay) {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, delay);
    timers.current.add(id);
    return id;
  }
  useEffect(() => {
    const id = setTimeout(() => setLoading(false), 650);
    return () => {
      clearTimeout(id);
      timers.current.forEach(clearTimeout);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveStorage("chatty.theme.v1", theme);
  }, [theme]);
  useEffect(() => saveStorage("chatty.chats.v1", chats), [chats]);
  useEffect(() => saveStorage("chatty.drafts.v1", drafts), [drafts]);
  useEffect(() => saveStorage("chatty.profile.v1", profile), [profile]);
  useEffect(() => {
    getMe().then(
      ({ user }) => {
        setUser(user);
        setActive(null);
        setMode("live");
      },
      () => setMode("auth"),
    );
  }, []);
  useEffect(() => {
    function shortcut(e) {
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName) &&
        !modal
      ) {
        e.preventDefault();
        document.querySelector('[aria-label="Search conversations"]')?.focus();
      }
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, [modal]);
  useEffect(() => {
    const offline = () => setNetwork("offline"),
      online = () => {
        setNetwork("reconnecting");
        later(() => setNetwork("online"), 1800);
      };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);
  function notify(text, icon = "✓") {
    setToast(`${icon} ${text}`);
    later(() => setToast(""), 2800);
  }
  function select(id) {
    setActive(id);
    setMobileChat(true);
    setChats((cs) => cs.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
  }
  function themeToggle() {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  }
  function send() {
    if (live) return liveChat.send();
    const text = (drafts[active] || "").trim();
    if (/^\/gif(?:\s|$)/.test(text)) return notify('GIFs need the live server', '!');
    if (!text || !chat) return;
    const id = crypto.randomUUID(),
      chatId = active;
    const failed = failNext || network !== "online";
    setFailNext(false);
    const time = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });
    setChats((cs) =>
      cs.map((c) =>
        c.id === chatId
          ? {
              ...c,
              time,
              messages: [
                ...c.messages,
                { id, author: "me", text, time, status: "sending" },
              ],
            }
          : c,
      ),
    );
    setDrafts((d) => ({ ...d, [chatId]: "" }));
    later(
      () =>
        setChats((cs) =>
          updateStatus(cs, chatId, id, failed ? "failed" : "sent"),
        ),
      800,
    );
  }
  function retry(id) {
    if (live) return liveChat.retry(id);
    const chatId = active;
    setChats((cs) => updateStatus(cs, chatId, id, "sending"));
    later(
      () =>
        setChats((cs) =>
          updateStatus(
            cs,
            chatId,
            id,
            network === "online" ? "sent" : "failed",
          ),
        ),
      700,
    );
  }
  async function direct(p) {
    if (live) {
      const id = await liveChat.direct(p);
      if (id) { select(id); setModal(null); }
      return;
    }
    let existing = chats.find(
      (c) => c.type === "direct" && c.members.includes(p.id),
    );
    if (!existing) {
      existing = {
        id: crypto.randomUUID(),
        type: "direct",
        name: p.name,
        avatar: p.avatar,
        members: ["me", p.id],
        messages: [],
        unread: 0,
        time: "Now",
        olderLoaded: true,
      };
      setChats((cs) => [...cs, existing]);
    }
    select(existing.id);
    setModal(null);
  }
  async function group(name, members) {
    if (live) {
      // Errors propagate to the dialog, which shows the server's message.
      const id = await liveChat.group(name, members);
      if (id) { select(id); setModal(null); notify("Your little workspace is ready."); }
      return;
    }
    const c = {
      id: crypto.randomUUID(),
      type: "group",
      name,
      avatar: "forest",
      owner: "me",
      members: ["me", ...members],
      description: "A new space to build something together.",
      messages: [],
      unread: 0,
      time: "Now",
      olderLoaded: true,
    };
    setChats((cs) => [...cs, c]);
    setActive(c.id);
    setMobileChat(true);
    setModal(null);
    notify("Your little workspace is ready.");
  }
  function loadOlder() {
    if (live) return liveChat.older();
    const chatId = active;
    setLoadingOlder(true);
    later(() => {
      setChats((cs) =>
        cs.map((c) =>
          c.id === chatId
            ? {
                ...c,
                olderLoaded: true,
                messages: [...olderMessages(chatId), ...c.messages],
              }
            : c,
        ),
      );
      setLoadingOlder(false);
    }, 900);
  }
  // Live confirmations run a request; failures become a toast (the dialog stays usable).
  const attempt = (request, success) =>
    request.then(() => success && notify(success), (err) => notify(err.message, "!"));
  function transfer(id) {
    const person = chat.people.find((p) => p.id === id);
    setConfirmation({
      title: "Make them the owner?",
      text: `${person.name} will manage ${chat.name}. You’ll stay as a member.`,
      action: () => attempt(liveChat.transfer(chat.id, id), "Ownership transferred."),
    });
  }
  function remove(id) {
    const person = live ? chat.people.find((p) => p.id === id) : people.find((p) => p.id === id);
    setConfirmation({
      title: "Remove this teammate?",
      text: `${person.name} will no longer be part of ${chat.name}.`,
      action: () => {
        if (live) return attempt(liveChat.remove(chat.id, id), "Member removed.");
        setChats((cs) =>
          cs.map((c) =>
            c.id === active
              ? { ...c, members: c.members.filter((m) => m !== id) }
              : c,
          ),
        );
        notify("Member removed.");
      },
    });
  }
  function leave() {
    setConfirmation({
      title: "Leave this group?",
      text: `You’ll leave ${chat.name} and it will be removed from your conversation list.${!live && chat.owner === "me" ? " Ownership will pass to the next member." : ""}`,
      action: () => {
        if (live) {
          const id = chat.id;
          return attempt(liveChat.leave(id).then(() => {
            setActive((current) => (current === id ? null : current));
            setMobileChat(false);
            setModal(null);
          }), "You left the group.");
        }
        setChats((cs) => cs.filter((c) => c.id !== active));
        setActive(null);
        setMobileChat(false);
        setModal(null);
        notify("You left the group.");
      },
    });
  }
  if (mode === "checking") return null;
  if (mode === "auth")
    return (
      <Auth
        onLive={(u) => {
          setUser(u);
          setMode("live");
          setActive(null);
        }}
        onDemo={() => {
          setMode("demo");
          setLoading(true);
          later(() => setLoading(false), 600);
        }}
      />
    );
  return (
    <div className={`workspace ${mobileChat ? "show-chat" : ""}`}>
      <Sidebar
        chats={shownChats}
        active={active}
        onSelect={select}
        search={search}
        setSearch={setSearch}
        onNew={() => setModal("new")}
        profile={shownProfile}
        theme={theme}
        onTheme={themeToggle}
        onProfile={() => setModal("profile")}
        onLogout={async () => {
          if (live) {
            try {
              await logout();
            } catch {
              return notify("We couldn’t sign you out. Try again.", "!");
            }
            setUser(null);
            liveChat.clearDrafts();
          }
          setModal(null);
          setMode("auth");
        }}
        onDemo={live ? undefined : () => setModal("demo")}
      />
      {live && liveChat.error && <div role="alert" className="network-banner">{liveChat.error} <button onClick={liveChat.reload}>Retry loading conversations</button></div>}
      {(live ? liveChat.loading : loading) ? (
        <main className="chat-main loading-screen">
          <Brand />
          <div className="loading-bars">
            <i />
            <i />
            <i />
          </div>
          <p>Making room for your conversations…</p>
        </main>
      ) : (
        <Chat
          key={chat?.id || 'empty'}
          onGifSend={live ? liveChat.send : undefined}
          onReloadHistory={live ? liveChat.reloadHistory : undefined}
          onReadLatest={live ? liveChat.markRead : undefined}
          visible={mobileChat}
          chat={chat}
          profile={shownProfile}
          draft={live ? liveChat.draft : drafts[active] || ""}
          onDraft={live ? liveChat.setDraft : (value) => setDrafts((d) => ({ ...d, [active]: value }))}
          onSend={send}
          onRetry={retry}
          onBack={() => setMobileChat(false)}
          onDetails={() => setModal("details")}
          onOlder={loadOlder}
          loadingOlder={live ? liveChat.loadingOlder : loadingOlder}
          network={live ? liveChat.network : network}
          typing={
            !live && typing && network === "online" && !!chat?.members.includes("alice")
          }
        />
      )}
      {modal === "new" && (
        <ConversationDialog
          live={live}
          onClose={() => setModal(null)}
          onDirect={direct}
          onGroup={group}
        />
      )}{" "}
      {modal === "profile" && (
        <ProfileDialog
          profile={shownProfile}
          onSave={async (p) => {
            if (live)
              setUser(
                (await updateMe({ displayName: p.name, avatarId: p.avatar })).user,
              );
            else setProfile(p);
            setModal(null);
            notify("Looking good. Profile updated.");
          }}
          onClose={() => setModal(null)}
          theme={theme}
          onTheme={themeToggle}
        />
      )}{" "}
      {modal === "details" && chat && !confirmation && (
        <DetailsDialog
          chat={chat}
          profile={shownProfile}
          onClose={() => setModal(null)}
          onMembers={() => setModal("members")}
          onRemove={remove}
          onLeave={leave}
          onTransfer={live ? transfer : undefined}
        />
      )}{" "}
      {modal === "members" && chat && (
        <AddMembersDialog
          chat={chat}
          live={live}
          onClose={() => setModal("details")}
          onAdd={async (ids) => {
            if (live) {
              // Errors propagate to the dialog (e.g. group_full).
              await liveChat.add(chat.id, ids);
              setModal("details");
              return notify("A few more minds in the room.");
            }
            setChats((cs) =>
              cs.map((c) =>
                c.id === active
                  ? { ...c, members: [...new Set([...c.members, ...ids])] }
                  : c,
              ),
            );
            setModal("details");
            notify("A few more minds in the room.");
          }}
        />
      )}
      {confirmation && (
        <ConfirmDialog
          title={confirmation.title}
          text={confirmation.text}
          onClose={() => setConfirmation(null)}
          onConfirm={() => {
            confirmation.action();
            setConfirmation(null);
          }}
        />
      )}
      {modal === "demo" && !confirmation && (
        <DemoDialog
          onReset={() =>
            setConfirmation({
              title: "Reset the demo?",
              text: "This restores the sample conversations and profile and clears your local demo messages and drafts. Your theme preference stays.",
              action: () => {
                setChats(
                  structuredClone(initialConversations).map((c) => ({
                    ...c,
                    unread: c.id === "workshop" ? 0 : c.unread,
                  })),
                );
                setDrafts({});
                setProfile({ name: "Alex Morgan", avatar: "cat" });
                setActive("workshop");
                setMobileChat(false);
                setNetwork("online");
                setFailNext(false);
                setTyping(true);
                setModal(null);
                notify("A fresh start. Demo data restored.");
              },
            })
          }
          network={network}
          onNetwork={(value) => {
            setNetwork(value);
            if (value === "reconnecting")
              later(
                () => setNetwork((n) => (n === "reconnecting" ? "online" : n)),
                3000,
              );
          }}
          failNext={failNext}
          setFailNext={setFailNext}
          typing={typing}
          setTyping={setTyping}
          onEmpty={() => {
            setActive(null);
            setModal(null);
            setMobileChat(false);
          }}
          onLoading={() => {
            setModal(null);
            setLoading(true);
            later(() => setLoading(false), 1500);
          }}
          onClose={() => setModal(null)}
        />
      )}{" "}
      {toast && (
        <div className="toast-message" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
