// A REST acknowledgement and socket push can arrive in either order.
export function mergeMessages(current, incoming) {
  const messages = [...current];
  for (const message of incoming) {
    const index = messages.findIndex(m => m.id === message.id ||
      (message.clientMessageId && m.clientMessageId === message.clientMessageId && m.senderId === message.senderId));
    const next = message.seq ? { ...message, status: 'sent' } : message;
    if (index < 0) messages.push(next);
    else messages[index] = next;
  }
  return messages.sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity));
}

// Never render stored/provider URLs; only validated IDs reach the media host.
export const gifUrl = id => typeof id === 'string' && /^[A-Za-z0-9]{1,100}$/.test(id)
  ? `https://media.giphy.com/media/${id}/giphy.gif` : null;

// Highest server-confirmed seq in a message list (pending messages have none); 0 if empty.
export const latestSeq = (messages) =>
  Math.max(0, ...(messages ?? []).map((m) => m.seq ?? 0));

// Whether a pushed message should raise the unread badge: someone else sent it, it is
// newer than what this chat already knows (pushes can repeat or race history loads),
// and it lies after my read cursor.
export function countsAsUnread(chat, message, userId) {
  if (message.senderId === userId) return false;
  const known = Math.max(latestSeq(chat.messages), chat.lastMessage?.seq ?? 0);
  return message.seq > known && message.seq > (chat.lastReadSeq ?? 0);
}

export function viewConversation(c, userId) {
  // Direct chats have a peer; groups (M3a) do not. Full group UI arrives in M3c.
  const peer = c.peer
    ? { ...c.peer, name: c.peer.displayName, avatar: c.peer.avatarId }
    : null;
  const messages = (c.messages ?? []).map(m => ({ ...m,
    author: m.senderId === userId ? 'me' : m.senderId,
    text: m.body, time: new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),
    date: new Date(m.createdAt).toLocaleDateString([], {year:'numeric',month:'long',day:'numeric'}),
  }));
  return { ...c, live:true, name:peer?.name ?? c.name, avatar:peer?.avatar ?? 'forest', peer,
    members: peer ? ['me',peer.id] : [], messages,
    // Server-computed count of others' messages after my cursor (kept current locally).
    unread: c.unreadCount ?? 0,
    olderLoaded: c.hasMore === false,
    time: c.lastMessage ? new Date(c.lastMessage.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '',
    preview: c.lastMessage?.body,
  };
}
