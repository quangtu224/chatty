import { useEffect, useState } from "react";
import { searchUsers } from '../services/api.js';
import {
  Search,
  Plus,
  Check,
  UserMinus,
  Crown,
  LogOut,
} from "lucide-react";
import { Modal, Avatar } from "./UI.jsx";
import { AVATARS } from "../model.js";
// Live user search shared by the new-conversation and add-members dialogs.
function useUserSearch(search, setError) {
  const [results,setResults]=useState([]), [searching,setSearching]=useState(false);
  useEffect(()=>{
    let cancelled=false;
    setResults([]); setError('');
    if (!search.trim()) { setSearching(false); return; }
    setSearching(true);
    // Ignore stale searches and debounce typing to avoid exhausting the search quota.
    const timer=setTimeout(()=>searchUsers(search.trim()).then(({users})=>{
      if (!cancelled) setResults(users.map(p=>({...p,name:p.displayName,avatar:p.avatarId})));
    }).catch(err=>{if (!cancelled) setError(err.message);}).finally(()=>{if(!cancelled)setSearching(false);}),250);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[search]);
  return {results,searching};
}
// Picked people stay listed (first) while the search text changes.
const withPicked = (picked, results) =>
  [...picked, ...results.filter(p => !picked.some(q => q.id === p.id))];
// Adds or removes one person from a picked list.
const toggle = (list, item, same = (a) => a === item) =>
  list.some(same) ? list.filter((a) => !same(a)) : [...list, item];
// Prefer a field message from the server (e.g. memberIds) over the generic one.
const errorText = (err) => Object.values(err.fieldErrors ?? {})[0] ?? err.message;

export function ConversationDialog({ onClose, onDirect, onGroup }) {
  const [tab, setTab] = useState("direct"),
    [search, setSearch] = useState(""),
    [name, setName] = useState(""),
    [members, setMembers] = useState([]),
    [error, setError] = useState("");
  const [busy,setBusy]=useState(false), [picked,setPicked]=useState([]);
  const {results,searching}=useUserSearch(search,setError);
  const list = tab === "group" ? withPicked(picked, results) : results;
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
            disabled={busy}
            onClick={() => {
              if (tab === "direct") {
                setBusy(true);
                Promise.resolve(onDirect(p)).catch(err=>setError(err.message)).finally(()=>setBusy(false));
              }
              else {
                setMembers((m) => toggle(m, p.id));
                setPicked((list) => toggle(list, p, (q) => q.id === p.id));
              }
            }}
          >
            <Avatar name={p.avatar} online={p.online} />
            <span>
              <strong>{p.name}</strong>
              <small>
                @{p.handle}
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
            {searching ? 'Searching…' : !search.trim() ? 'Type a name or username to find a teammate.' : 'No teammates found. Try another name.'}
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
            disabled={busy}
            onClick={() => {
              if (!name.trim()) setError("Give your group a name.");
              else if (!members.length)
                setError("Choose at least one teammate.");
              else {
                // Live creation is async: the server's message appears here on failure.
                setBusy(true);
                Promise.resolve(onGroup(name.trim(), members))
                  .catch((err) => setError(errorText(err)))
                  .finally(() => setBusy(false));
              }
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
          {AVATARS.map((a) => (
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
            else
              Promise.resolve(onSave({ name: name.trim(), avatar })).catch(
                (err) => setError(err.message),
              );
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
  onTransfer,
}) {
  const owner = chat.owner === "me";
  // The live server refuses an owner leaving while others remain (transfer_required).
  const mustTransfer = owner && chat.members.length > 1;
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
          ? `${chat.memberCount} ${chat.memberCount === 1 ? "member" : "members"}`
          : "In this conversation"}
        {owner && <span>You’re the owner</span>}
      </div>
      {chat.type === "group" && !chat.people && (
        <p className="dialog-description" role="status">Loading members…</p>
      )}
      <div className="member-picker">
        {chat.members.map((id) => {
          const p =
            id === "me"
              ? { ...profile, id: "me" }
              : chat.peer ?? chat.people?.find((p) => p.id === id) ?? {name:'Member',avatar:'forest'};
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
                    : p.online === undefined
                      ? "Member"
                      : p.online
                        ? "Online · Member"
                        : "Offline · Member"}
                </small>
              </span>
              {owner && id !== "me" && onTransfer && (
                <button
                  className="icon-button"
                  aria-label={`Make ${p.name} the owner`}
                  title="Make owner"
                  onClick={() => onTransfer(id)}
                >
                  <Crown size={17} />
                </button>
              )}
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
          <button className="btn danger-button" onClick={onLeave} disabled={mustTransfer}>
            <LogOut size={15} /> Leave group
          </button>
          {owner && (
            <small>
              {mustTransfer
                ? "Make someone else the owner before you leave."
                : "You’re the last member: leaving closes the group."}
            </small>
          )}
        </div>
      )}
    </Modal>
  );
}
export function AddMembersDialog({ chat, onClose, onAdd }) {
  const [ids, setIds] = useState([]), [picked, setPicked] = useState([]);
  const [search, setSearch] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const {results,searching}=useUserSearch(search,setError);
  // Search real users without current members.
  const available = withPicked(picked, results.filter((p) => !chat.members.includes(p.id)));
  return (
    <Modal title="Invite a few more minds" onClose={onClose}>
      <p className="dialog-description">Add teammates to {chat.name}.</p>
      {(
        <div className="search-box">
          <Search size={16} />
          <input
            aria-label="Search teammates"
            placeholder="Search by name or username…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}
      {available.map((p) => (
        <button
          className="person-row"
          key={p.id}
          onClick={() => {
            setIds((a) => toggle(a, p.id));
            setPicked((list) => toggle(list, p, (q) => q.id === p.id));
          }}
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
      {available.length === 0 && (
        <p className="dialog-description">
          {searching
              ? "Searching…"
              : search.trim()
                ? "No teammates found. Try another name."
                : "Type a name or username to find a teammate."}
        </p>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-footer">
        <button className="btn btn-outline-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={!ids.length || busy}
          onClick={() => {
            setBusy(true);
            Promise.resolve(onAdd(ids))
              .catch((err) => setError(errorText(err)))
              .finally(() => setBusy(false));
          }}
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
