import { create } from 'zustand';
import { getSocket } from '../race/socket';

export interface OnlineUser {
  userId: number;
  displayName: string;
}

export interface IncomingNotification {
  fromUserId: number;
  fromDisplayName: string;
  message: string;
  sentAt: number;
}

type SendResult = { ok: true } | { error: string };

interface PresenceState {
  onlineUsers: OnlineUser[];
  incomingNotification: IncomingNotification | null;
  connect: (currentUserId: number) => void;
  sendNotification: (toUserId: number, message: string) => Promise<SendResult>;
  dismissNotification: () => void;
}

// The socket itself is a module-level singleton (see race/socket.ts) shared
// with race mode - but the 'presence:online'/'notify:receive' listeners
// below must only ever be attached once for the app's whole lifetime, or a
// remount of whatever calls connect() (e.g. React StrictMode, or a login/
// logout cycle) would stack duplicate listeners and the online list would
// process the same broadcast N times.
let listenersRegistered = false;

export const usePresenceStore = create<PresenceState>((set) => ({
  onlineUsers: [],
  incomingNotification: null,

  connect: (currentUserId) => {
    if (listenersRegistered) return;
    listenersRegistered = true;

    const socket = getSocket();
    socket.on('presence:online', (list: OnlineUser[]) => {
      set({ onlineUsers: list.filter((u) => u.userId !== currentUserId) });
    });
    socket.on('notify:receive', (data: IncomingNotification) => {
      set({ incomingNotification: data });
    });
  },

  sendNotification: (toUserId, message) =>
    new Promise((resolve) => {
      getSocket().emit('notify:send', { toUserId, message }, (res: SendResult) => resolve(res));
    }),

  dismissNotification: () => set({ incomingNotification: null }),
}));
