import type { Server as SocketServer } from 'socket.io';
import { findValidSessionUser } from './db.js';
import { getSessionTokenFromCookieHeader } from './auth.js';

// Same-user, multiple tabs/devices (phone + a browser tab left open, say) -
// tracked as a set of socket ids per user so the user only ever disappears
// from the online list once every one of their connections has dropped, not
// the first time any single tab closes.
interface OnlineUser {
  userId: number;
  displayName: string;
  socketIds: Set<string>;
}

const online = new Map<number, OnlineUser>();

function publicOnlineList() {
  return [...online.values()]
    .map((u) => ({ userId: u.userId, displayName: u.displayName }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'he'));
}

function broadcastOnline(io: SocketServer): void {
  io.emit('presence:online', publicOnlineList());
}

const MAX_MESSAGE_LENGTH = 500;

export function registerPresenceHandlers(io: SocketServer): void {
  io.on('connection', (socket) => {
    const token = getSessionTokenFromCookieHeader(socket.handshake.headers.cookie);
    const user = token ? findValidSessionUser(token) : undefined;
    if (!user) return;

    let entry = online.get(user.id);
    if (!entry) {
      entry = { userId: user.id, displayName: user.display_name, socketIds: new Set() };
      online.set(user.id, entry);
    }
    entry.socketIds.add(socket.id);
    broadcastOnline(io);

    // Sending the roster only to everyone else via broadcastOnline can leave
    // THIS socket's very first render one round-trip behind (it connected
    // after that broadcast's snapshot was built) - an immediate direct
    // send closes that gap.
    socket.emit('presence:online', publicOnlineList());

    socket.on(
      'notify:send',
      (data: { toUserId?: unknown; message?: unknown }, ack?: (res: { ok: true } | { error: string }) => void) => {
        const toUserId = typeof data.toUserId === 'number' ? data.toUserId : null;
        const message = typeof data.message === 'string' ? data.message.trim().slice(0, MAX_MESSAGE_LENGTH) : '';
        if (!toUserId || !message) return ack?.({ error: 'הודעה לא תקינה' });
        if (toUserId === user.id) return ack?.({ error: 'אי אפשר לשלוח הודעה לעצמך' });

        const target = online.get(toUserId);
        if (!target || target.socketIds.size === 0) return ack?.({ error: 'המשתמש כבר לא מחובר' });

        for (const socketId of target.socketIds) {
          io.to(socketId).emit('notify:receive', {
            fromUserId: user.id,
            fromDisplayName: user.display_name,
            message,
            sentAt: Date.now(),
          });
        }
        ack?.({ ok: true });
      }
    );

    socket.on('disconnect', () => {
      const current = online.get(user.id);
      if (!current) return;
      current.socketIds.delete(socket.id);
      if (current.socketIds.size === 0) {
        online.delete(user.id);
        broadcastOnline(io);
      }
    });
  });
}
