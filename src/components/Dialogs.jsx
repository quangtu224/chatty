import { useState } from "react";
import {
  Search,
  Plus,
  Check,
  UserMinus,
  LogOut,
  Wifi,
  WifiOff,
  RotateCw,
} from "lucide-react";
import { Modal, Avatar } from "./UI.jsx";
import { people } from "../data.js";
export function ConversationDialog({ onClose, onDirect, onGroup }) {
  const [tab, setTab] = useState("direct"),
    [search, setSearch] = useState(""),
    [name, setName] = useState(""),
    [members, setMembers] = useState([]),
    [error, setError] = useState("");
  const list = people.filter(
    (p) =>
      p.id !== "me" &&
      `${p.name} ${p.handle}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Modal
      title={tab === "direct" ? "Start a conversation" : "Create a group"}
      onClose={onClose}
    >
      <p className="dialog-description">
        {tab === "direct"
          ? "A quick hello can go a long way."
          : "A little space for your people and your ideas."}
      </p>
      <div className="dialog-tabs">
        <button
          className={tab === "direct" ? "active" : ""}
          onClick={() => setTab("direct")}
        >
          Direct message
        </button>
        <button
          className={tab === "group" ? "active" : ""}
          onClick={() => setTab("group")}
        >
          Group chat
        </button>
      </div>
      {tab === "group" && (
        <label className="field">
          Group name
          <input
            className="form-control"
            placeholder="e.g. The bug hunters"
            maxLength={48}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      )}
      <label className="field">
        {tab === "direct" ? "Find a teammate" : "Choose members"}
        <div className="search-box">
          <Search size={16} />
          <input
            aria-label="Search teammates"
            placeholder="Search by name or username…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </label>
      <div className="member-picker">
        {list.map((p) => (
          <button
            className={`person-row ${members.includes(p.id) ? "picked" : ""}`}
            key={p.id}
            onClick={() => {
              if (tab === "direct") onDirect(p);
              else
                setMembers((m) =>
                  m.includes(p.id)
                    ? m.filter((id) => id !== p.id)
                    : [...m, p.id],
                );
            }}
          >
            <Avatar name={p.avatar} online={p.online} />
            <span>
              <strong>{p.name}</strong>
              <small>
                @{p.handle} · {p.online ? "Online" : "Offline"}
              </small>
            </span>
            {tab === "group" ? (
              <span
                className="checkbox"
                aria-label={
                  members.includes(p.id) ? "Selected" : "Not selected"
                }
              >
                {members.includes(p.id) && <Check size={14} />}
              </span>
            ) : (
              <Plus size={17} />
            )}
          </button>
        ))}
        {list.length === 0 && (
          <p className="dialog-description">
            No teammates found. Try another name.
          </p>
        )}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {tab === "group" && (
        <div className="dialog-footer">
          <span>{members.length} selected</span>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!name.trim()) setError("Give your group a name.");
              else if (!members.length)
                setError("Choose at least one teammate.");
              else onGroup(name.trim(), members);
            }}
          >
            Create group <Plus size={16} />
          </button>
        </div>
      )}
    </Modal>
  );
}
export function ProfileDialog({ profile, onSave, onClose, theme, onTheme }) {
  const [name, setName] = useState(profile.name),
    [avatar, setAvatar] = useState(profile.avatar),
    [error, setError] = useState("");
  return (
    <Modal title="Make yourself at home" onClose={onClose}>
      <p className="dialog-description">
        A familiar face. A name your team knows.
      </p>
      <div className="profile-preview">
        <Avatar name={avatar} size={75} />
      </div>
      <label className="field">
        Display name
        <input
          className="form-control"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="field">
        Choose your little companion
        <div className="avatar-picker">
          {["cat", "fox", "raccoon", "owl", "frog", "bear"].map((a) => (
            <button
              key={a}
              className={avatar === a ? "active" : ""}
              aria-label={`Select ${a} avatar`}
              aria-pressed={avatar === a}
              onClick={() => setAvatar(a)}
            >
              <Avatar name={a} size={46} />
            </button>
          ))}
        </div>
      </div>
      <div className="preference-row">
        <span>
          <strong>Appearance</strong>
          <small>A little easier on the eyes.</small>
        </span>
        <button className="btn btn-outline-secondary" onClick={onTheme}>
          {theme === "light" ? "Light" : "Dark"} theme
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-footer">
        <button className="btn btn-outline-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            if (!name.trim()) setError("Please enter your display name.");
            else onSave({ name: name.trim(), avatar });
          }}
        >
          Save changes
        </button>
      </div>
    </Modal>
  );
}
export function DetailsDialog({
  chat,
  profile,
  onClose,
  onMembers,
  onRemove,
  onLeave,
}) {
  const owner = chat.owner === "me";
  return (
    <Modal
      title={chat.type === "group" ? "Group details" : "Contact details"}
      onClose={onClose}
    >
      <div className="details-hero">
        <Avatar name={chat.avatar} size={88} />
        <h3>
          {chat.type === "group" ? "# " : ""}
          {chat.name}
        </h3>
        <p>{chat.description || "Good conversations start with a hello."}</p>
      </div>
      <div className="section-label">
        {chat.type === "group"
          ? `${chat.members.length} members`
          : "In this conversation"}
        {owner && <span>You’re the owner</span>}
      </div>
      <div className="member-picker">
        {chat.members.map((id) => {
          const p =
            id === "me"
              ? { ...profile, id: "me", online: true }
              : people.find((p) => p.id === id);
          return (
            <div className="person-row" key={id}>
              <Avatar name={p.avatar} online={p.online} />
              <span>
                <strong>
                  {p.name}
                  {id === "me" ? " (you)" : ""}
                </strong>
                <small>
                  {chat.owner === id
                    ? "Owner"
                    : p.online
                      ? "Online · Member"
                      : "Offline · Member"}
                </small>
              </span>
              {owner && id !== "me" && (
                <button
                  className="icon-button remove-button"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => onRemove(id)}
                >
                  <UserMinus size={17} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {chat.type === "group" && (
        <div className="details-actions">
          {owner && (
            <button className="btn btn-outline-secondary" onClick={onMembers}>
              <Plus size={16} /> Add members
            </button>
          )}
          <button className="btn danger-button" onClick={onLeave}>
            <LogOut size={15} /> Leave group
          </button>
          {owner && (
            <small>If you leave, ownership passes to the next member.</small>
          )}
        </div>
      )}
    </Modal>
  );
}
export function AddMembersDialog({ chat, onClose, onAdd }) {
  const [ids, setIds] = useState([]);
  const available = people.filter((p) => !chat.members.includes(p.id));
  return (
    <Modal title="Invite a few more minds" onClose={onClose}>
      <p className="dialog-description">Add teammates to {chat.name}.</p>
      {available.map((p) => (
        <button
          className="person-row"
          key={p.id}
          onClick={() =>
            setIds((a) =>
              a.includes(p.id) ? a.filter((id) => id !== p.id) : [...a, p.id],
            )
          }
        >
          <Avatar name={p.avatar} />
          <span>
            <strong>{p.name}</strong>
            <small>@{p.handle}</small>
          </span>
          <span className="checkbox">
            {ids.includes(p.id) && <Check size={14} />}
          </span>
        </button>
      ))}
      {available.length === 0 && <p>Everyone’s already here!</p>}
      <div className="dialog-footer">
        <button className="btn btn-outline-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={!ids.length}
          onClick={() => onAdd(ids)}
        >
          Add {ids.length || ""} members
        </button>
      </div>
    </Modal>
  );
}
export function ConfirmDialog({ title, text, onClose, onConfirm }) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="dialog-description">{text}</p>
      <div className="dialog-footer">
        <button className="btn btn-outline-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn danger-button" onClick={onConfirm}>
          Confirm
        </button>
      </div>
    </Modal>
  );
}
export function DemoDialog({
  network,
  onNetwork,
  failNext,
  setFailNext,
  typing,
  setTyping,
  onEmpty,
  onLoading,
  onReset,
  onClose,
}) {
  return (
    <Modal title="Demo controls" onClose={onClose}>
      <p className="dialog-description">
        Explore the edges. These controls simulate local states.
      </p>
      <div className="field">
        Connection
        <div className="network-options">
          {[
            ["online", Wifi],
            ["offline", WifiOff],
            ["reconnecting", RotateCw],
          ].map(([value, Icon]) => (
            <button
              className={`btn ${network === value ? "btn-primary" : "btn-outline-secondary"}`}
              key={value}
              onClick={() => onNetwork(value)}
            >
              <Icon size={15} />
              {value}
            </button>
          ))}
        </div>
      </div>
      <label className="switch-row">
        <span>
          <strong>Fail the next message</strong>
          <small>Send a message, then use Retry to recover.</small>
        </span>
        <input
          className="form-check-input"
          type="checkbox"
          checked={failNext}
          onChange={(e) => setFailNext(e.target.checked)}
        />
      </label>
      <label className="switch-row">
        <span>
          <strong>Alice is typing</strong>
          <small>Show the mock typing indicator.</small>
        </span>
        <input
          className="form-check-input"
          type="checkbox"
          checked={typing}
          onChange={(e) => setTyping(e.target.checked)}
        />
      </label>
      <div className="demo-state-actions">
        <button className="btn btn-outline-secondary" onClick={onEmpty}>
          Show no conversation selected
        </button>
        <button className="btn btn-outline-secondary" onClick={onLoading}>
          Replay initial loading
        </button>
        <button className="btn btn-outline-secondary" onClick={onReset}>
          Reset demo data
        </button>
      </div>
      <p className="demo-disclosure">
        Messages, authentication, presence, and network activity are simulated.
        Sent means stored locally; read receipts are not implemented.
      </p>
    </Modal>
  );
}
