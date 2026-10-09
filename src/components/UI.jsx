import { useEffect, useRef } from "react";
import { X } from "lucide-react";
export function Avatar({ name = "cat", size = 42, online, label = "" }) {
  return (
    <span
      className={`avatar avatar-${name}`}
      style={{ width: size, height: size }}
    >
      <img
        src={`/avatars/${name}.svg`}
        alt={label}
        width={size}
        height={size}
      />
      {online !== undefined && (
        <span
          className={`presence ${online ? "online" : ""}`}
          title={online ? "Online" : "Offline"}
        />
      )}
    </span>
  );
}
export function Brand() {
  return (
    <div className="brand">
      <Avatar name="brand" size={48} />
      <div>
        <strong>
          chatty<span className="brand-dot">.</span>
        </strong>
        <small>A little more connected.</small>
      </div>
    </div>
  );
}
export function IconButton({ label, children, ...props }) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
export function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.isConnected && previous.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="chat-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <IconButton label="Close dialog" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
export function EmptyState({ title, children }) {
  return (
    <div className="empty-state">
      <Avatar name="forest" size={100} />
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function SafeText({ text }) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}
