import { create } from 'zustand';
import {
  fetchFriends,
  fetchFriendRequests,
  fetchFriendCandidates,
  sendFriendRequest as apiSendFriendRequest,
  acceptFriendRequest as apiAcceptFriendRequest,
  removeFriendship as apiRemoveFriendship,
  type Friend,
  type FriendRequest,
  type FriendCandidate,
} from '../api';

interface FriendsState {
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  candidates: FriendCandidate[];
  loading: boolean;
  error: string | null;
  loadAll: () => Promise<void>;
  sendRequest: (userId: number) => Promise<void>;
  accept: (userId: number) => Promise<void>;
  decline: (userId: number) => Promise<void>;
}

// One shared store (not per-screen local state) so accepting a request on
// the Friends screen is immediately reflected wherever else friend status
// matters (e.g. a "start chat" button elsewhere becoming enabled).
export const useFriendsStore = create<FriendsState>((set, get) => ({
  friends: [],
  incoming: [],
  outgoing: [],
  candidates: [],
  loading: false,
  error: null,

  loadAll: async () => {
    set({ loading: true, error: null });
    try {
      const [friends, requests, candidates] = await Promise.all([
        fetchFriends(),
        fetchFriendRequests(),
        fetchFriendCandidates(),
      ]);
      set({ friends, incoming: requests.incoming, outgoing: requests.outgoing, candidates, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  sendRequest: async (userId) => {
    await apiSendFriendRequest(userId);
    await get().loadAll();
  },
  accept: async (userId) => {
    await apiAcceptFriendRequest(userId);
    await get().loadAll();
  },
  decline: async (userId) => {
    await apiRemoveFriendship(userId);
    await get().loadAll();
  },
}));
