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
  const [authenticated, setAuthenticated] = useState(() =>
    readStorage("chatty.session.v1", true),
  );
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
  const chat = chats.find((c) => c.id === active);
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
  useEffect(
    () => saveStorage("chatty.session.v1", authenticated),
    [authenticated],
  );
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
  function notify(text) {
    setToast(text);
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
    const text = (drafts[active] || "").trim();
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
  function direct(p) {
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
  function group(name, members) {
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
  function remove(id) {
    setConfirmation({
      title: "Remove this teammate?",
      text: `${people.find((p) => p.id === id).name} will no longer be part of ${chat.name}.`,
      action: () => {
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
      text: `You’ll leave ${chat.name} and it will be removed from your conversation list.${chat.owner === "me" ? " Ownership will pass to the next member." : ""}`,
      action: () => {
        setChats((cs) => cs.filter((c) => c.id !== active));
        setActive(null);
        setMobileChat(false);
        setModal(null);
        notify("You left the group.");
      },
    });
  }
  if (!authenticated)
    return (
      <Auth
        onEnter={(name) => {
          if (name) setProfile((p) => ({ ...p, name }));
          setAuthenticated(true);
          setLoading(true);
          later(() => setLoading(false), 600);
        }}
      />
    );
  return (
    <div className={`workspace ${mobileChat ? "show-chat" : ""}`}>
      <Sidebar
        chats={chats}
        active={active}
        onSelect={select}
        search={search}
        setSearch={setSearch}
        onNew={() => setModal("new")}
        profile={profile}
        theme={theme}
        onTheme={themeToggle}
        onProfile={() => setModal("profile")}
        onLogout={() => {
          setAuthenticated(false);
          setModal(null);
        }}
        onDemo={() => setModal("demo")}
      />
      {loading ? (
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
          visible={mobileChat}
          chat={chat}
          profile={profile}
          draft={drafts[active] || ""}
          onDraft={(value) => setDrafts((d) => ({ ...d, [active]: value }))}
          onSend={send}
          onRetry={retry}
          onBack={() => setMobileChat(false)}
          onDetails={() => setModal("details")}
          onOlder={loadOlder}
          loadingOlder={loadingOlder}
          network={network}
          typing={
            typing && network === "online" && !!chat?.members.includes("alice")
          }
        />
      )}
      {modal === "new" && (
        <ConversationDialog
          onClose={() => setModal(null)}
          onDirect={direct}
          onGroup={group}
        />
      )}{" "}
      {modal === "profile" && (
        <ProfileDialog
          profile={profile}
          onSave={(p) => {
            setProfile(p);
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
          profile={profile}
          onClose={() => setModal(null)}
          onMembers={() => setModal("members")}
          onRemove={remove}
          onLeave={leave}
        />
      )}{" "}
      {modal === "members" && chat && (
        <AddMembersDialog
          chat={chat}
          onClose={() => setModal("details")}
          onAdd={(ids) => {
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
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
