import {
  Search,
  Plus,
  Sun,
  Moon,
  Settings,
  LogOut,
} from "lucide-react";
import { Avatar, Brand, IconButton } from "./UI.jsx";
import RoomDirectory from './RoomDirectory.jsx';
export default function Sidebar({
  chats,
  active,
  onSelect,
  search,
  setSearch,
  onNew,
  profile,
  theme,
  onTheme,
  onProfile,
  onLogout,
  onJoin,
  roomVersion,
}) {
  const filtered = chats.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <aside className="sidebar">
      <Brand />
      <div className="sidebar-actions">
        <div className="search-box">
          <Search size={17} />
          <input
            aria-label="Search conversations"
            placeholder="Search conversations…"
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd>/</kbd>
        </div>
        {onNew && (
          <button className="btn btn-primary new-button" onClick={onNew}>
            <Plus size={18} /> New conversation
          </button>
        )}
      </div>
      <nav className="conversation-nav" aria-label="Conversations">
        <RoomDirectory search={search} version={roomVersion} onJoin={onJoin} active={active} chats={chats}/>
        {['direct'].map((type) => (
          <section key={type}>
            <div className="section-label">
              {type === "group" ? "Group chats" : "Direct messages"}
              <span>{filtered.filter((c) => c.type === type).length}</span>
            </div>
            {filtered
              .filter((c) => c.type === type)
              .map((c) => (
                <button
                  key={c.id}
                  className={`conversation-row ${active === c.id ? "selected" : ""}`}
                  onClick={() => onSelect(c.id)}
                >
                  <Avatar
                    name={c.avatar}
                    online={c.peer?.online}
                    size={42}
                  />
                  <div className="conversation-copy">
                    <div className="conversation-title">
                      <strong>
                        {type === "group" && <span className="hash"># </span>}
                        {c.name}
                      </strong>
                      <time>{c.time}</time>
                    </div>
                    <div className="preview-line">
                      <span>
                        {c.preview || c.messages.at(-1)?.text || "Start the conversation"}
                      </span>
                      {c.unread > 0 && (
                        <b
                          className="unread-badge"
                          aria-label={`${c.unread} unread messages`}
                        >
                          {c.unread}
                        </b>
                      )}
                    </div>
                  </div>
                </button>
              ))}
          </section>
        ))}
        {filtered.length === 0 && (
          <div className="search-empty">
            <Search size={25} />
            <strong>No direct messages found</strong>
            <p>Try another name or start a direct chat.</p>
          </div>
        )}
      </nav>
      <div className="sidebar-footer">
        <div className="profile-bar">
          <button className="profile-button" onClick={onProfile}>
            <Avatar name={profile.avatar} />
            <span>
              <strong>{profile.name}</strong>
              <small>
                Signed in
              </small>
            </span>
          </button>
          <IconButton
            label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
            onClick={onTheme}
          >
            {theme === "light" ? <Moon size={19} /> : <Sun size={19} />}
          </IconButton>
          <IconButton label="Profile and preferences" onClick={onProfile}>
            <Settings size={19} />
          </IconButton>
        </div>
        <button className="logout" onClick={onLogout}>
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </aside>
  );
}
