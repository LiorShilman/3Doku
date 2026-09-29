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
  // Which friend's chat thread (if any) the player currently has open on
  // the dedicated chat page - see ChatScreen.tsx, which sets this so a
  // message from that exact person shows up live in the open thread instead
  // of ALSO popping the toast for a conversation already on screen.
  activeChatPartnerId: number | null;
  connect: (currentUserId: number) => void;
  sendNotification: (toUserId: number, message: string) => Promise<SendResult>;
  dismissNotification: () => void;
  setActiveChatPartner: (userId: number | null) => void;
}

// The socket itself is a module-level singleton (see race/socket.ts) shared
// with race mode - but the 'presence:online'/'notify:receive' listeners
// below must only ever be attached once for the app's whole lifetime, or a
// remount of whatever calls connect() (e.g. React StrictMode, or a login/
// logout cycle) would stack duplicate listeners and the online list would
// process the same broadcast N times.
let listenersRegistered = false;

export const usePresenceStore = create<PresenceState>((set, get) => ({
  onlineUsers: [],
  incomingNotification: null,
  activeChatPartnerId: null,

  connect: (currentUserId) => {
    if (listenersRegistered) return;
    listenersRegistered = true;

    const socket = getSocket();
    socket.on('presence:online', (list: OnlineUser[]) => {
      set({ onlineUsers: list.filter((u) => u.userId !== currentUserId) });
    });
    socket.on('notify:receive', (data: IncomingNotification) => {
      // Already visible live in the open chat thread (see ChatScreen.tsx's
      // own notify:receive listener) - showing the toast too would be
      // redundant for a conversation already on screen.
      if (get().activeChatPartnerId === data.fromUserId) return;
      set({ incomingNotification: data });
    });
  },

  sendNotification: (toUserId, message) =>
    new Promise((resolve) => {
      getSocket().emit('notify:send', { toUserId, message }, (res: SendResult) => resolve(res));
    }),

  dismissNotification: () => set({ incomingNotification: null }),
  setActiveChatPartner: (userId) => set({ activeChatPartnerId: userId }),
}));
