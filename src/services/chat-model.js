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

export function viewConversation(c, userId) {
  const peer = { ...c.peer, name: c.peer.displayName, avatar: c.peer.avatarId };
  const messages = (c.messages ?? []).map(m => ({ ...m,
    author: m.senderId === userId ? 'me' : m.senderId,
    text: m.body, time: new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),
    date: new Date(m.createdAt).toLocaleDateString([], {year:'numeric',month:'long',day:'numeric'}),
  }));
  return { ...c, live:true, name:peer.name, avatar:peer.avatar, peer,
    members:['me',peer.id], messages, unread:0, olderLoaded: c.hasMore === false,
    time: c.lastMessage ? new Date(c.lastMessage.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '',
    preview: c.lastMessage?.body,
  };
}
