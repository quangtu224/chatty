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
  // Direct chats have a peer; groups do not. Group member profiles (memberProfiles) are
  // loaded from GET /conversations/:id when the group is opened or changes; until then
  // `people` is null and authors show a neutral label.
  const profiles = c.memberProfiles?.map(p => ({ ...p, name: p.displayName, avatar: p.avatarId })) ?? null;
  const peer = c.peer
    ? { ...c.peer, name: c.peer.displayName, avatar: c.peer.avatarId }
    : null;
  const messages = (c.messages ?? []).map(m => ({ ...m,
    author: m.senderId === userId ? 'me' : m.senderId,
    text: m.body, time: new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),
    date: new Date(m.createdAt).toLocaleDateString([], {year:'numeric',month:'long',day:'numeric'}),
  }));
  return { ...c, live:true, name:peer?.name ?? c.name, avatar:peer?.avatar ?? 'forest', peer,
    // Same conventions as the demo data: "me" stands for the signed-in user.
    members: peer ? ['me',peer.id] : (profiles ?? []).map(p => p.id === userId ? 'me' : p.id),
    owner: c.ownerId === userId ? 'me' : c.ownerId ?? null,
    people: profiles, messages,
    // Server-computed count of others' messages after my cursor (kept current locally).
    unread: c.unreadCount ?? 0,
    olderLoaded: c.hasMore === false,
    time: c.lastMessage ? new Date(c.lastMessage.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '',
    preview: c.lastMessage?.body,
  };
}

// M3d: adds live presence and typing to a viewed conversation. `online` is the Set of
// contact ids with an open socket; `typingIds` are the members typing in this chat.
// Marks peer/people with `online`, counts online members and resolves typists to profiles
// (a typist whose profile is not loaded yet shows as "Someone").
export function withPresence(chat, online, typingIds = [], ready = true) {
  const mark = (p) => p && { ...p, online: ready ? online.has(p.id) : undefined };
  const peer = mark(chat.peer);
  const people = chat.people?.map(mark) ?? null;
  const known = peer ? [peer] : people ?? chat.readers?.map(p=>mark({...p,name:p.displayName,avatar:p.avatarId})) ?? [];
  return { ...chat, peer, people,
    onlineCount: ready ? known.filter((p) => p.online).length : null,
    typingPeople: typingIds.map((id) => known.find((p) => p.id === id) ?? { id, name: 'Someone', avatar: 'forest' }),
  };
}

// "Alice is typing", "Alice and Bob are typing", "Several people are typing" (first names).
export function typingText(people) {
  const names = people.map((p) => p.name.split(' ')[0]);
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return 'Several people are typing';
}

// M4 catch-up cursor: the highest seq reachable from the oldest loaded message without a
// hole. Server seqs are contiguous per conversation, so a jump means unseen messages that
// must be fetched (afterSeq) before anything is marked read past them. 0 when none loaded.
export function contiguousSeq(messages) {
  const seqs = (messages ?? []).map((m) => m.seq).filter(Boolean).sort((a, b) => a - b);
  let last = seqs[0] ?? 0;
  for (const seq of seqs) {
    if (seq > last + 1) break;
    last = Math.max(last, seq);
  }
  return last;
}

// Server snapshots (list refresh, details) can trail an optimistic local read. Never move
// the read cursor back: keep the local cursor and its unread count when it is ahead.
export function mergeReadState(old, incoming) {
  if(incoming.readers)incoming={...incoming,readers:incoming.readers.map(r=>({...r,
    lastReadSeq:Math.max(r.lastReadSeq,old?.readers?.find(p=>p.id===r.id)?.lastReadSeq??0)}))};
  return (old?.lastReadSeq ?? 0) > (incoming.lastReadSeq ?? 0)
    ? { ...incoming, lastReadSeq: old.lastReadSeq, unreadCount: old.unreadCount }
    : incoming;
}
