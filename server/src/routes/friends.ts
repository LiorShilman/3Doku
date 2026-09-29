import { Router } from 'express';
import { requireAuth } from './auth.js';
import {
  sendFriendRequest,
  acceptFriendRequest,
  removeFriendship,
  listFriends,
  listIncomingFriendRequests,
  listOutgoingFriendRequests,
  getFriendship,
  areFriends,
  getUserStats,
  getPokemonCollection,
  findUserById,
  listOtherUsers,
} from '../db.js';

export const friendsRouter = Router();

const ERROR_MESSAGES: Record<string, string> = {
  'already-friends': 'אתם כבר חברים',
  'already-pending': 'כבר יש בקשת חברות ממתינה ביניכם',
};

function parseUserIdParam(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id >= 1 ? id : null;
}

friendsRouter.get('/', requireAuth, (req, res) => {
  res.json({ friends: listFriends(req.user!.id) });
});

friendsRouter.get('/requests', requireAuth, (req, res) => {
  res.json({
    incoming: listIncomingFriendRequests(req.user!.id),
    outgoing: listOutgoingFriendRequests(req.user!.id),
  });
});

// Every OTHER registered user, each tagged with where things currently
// stand with them - lets the client render one unified "add a friend" list
// (send / pending / already friends) without a separate lookup per row.
// A family-scale app doesn't need pagination or search here yet.
friendsRouter.get('/candidates', requireAuth, (req, res) => {
  const myId = req.user!.id;
  const candidates = listOtherUsers(myId).map((u) => {
    const friendship = getFriendship(myId, u.id);
    let status: 'none' | 'friends' | 'pending-outgoing' | 'pending-incoming' = 'none';
    if (friendship?.status === 'accepted') status = 'friends';
    else if (friendship?.status === 'pending') status = friendship.requested_by === myId ? 'pending-outgoing' : 'pending-incoming';
    return { userId: u.id, displayName: u.display_name, status };
  });
  res.json({ candidates });
});

friendsRouter.post('/request', requireAuth, (req, res) => {
  const body = req.body as { toUserId?: unknown };
  const toUserId = typeof body.toUserId === 'number' ? body.toUserId : null;
  if (!toUserId) return res.status(400).json({ error: 'משתמש לא תקין' });
  if (toUserId === req.user!.id) return res.status(400).json({ error: 'אי אפשר לשלוח בקשת חברות לעצמך' });
  if (!findUserById(toUserId)) return res.status(404).json({ error: 'משתמש לא קיים' });

  const failure = sendFriendRequest(req.user!.id, toUserId);
  if (failure) return res.status(400).json({ error: ERROR_MESSAGES[failure] });
  res.status(201).json({ ok: true });
});

friendsRouter.post('/:userId/accept', requireAuth, (req, res) => {
  const otherUserId = parseUserIdParam(req.params.userId);
  if (!otherUserId) return res.status(400).json({ error: 'משתמש לא תקין' });
  const ok = acceptFriendRequest(req.user!.id, otherUserId);
  if (!ok) return res.status(404).json({ error: 'אין בקשת חברות ממתינה מהמשתמש הזה' });
  res.status(204).end();
});

// Also used to cancel a request you sent, or to unfriend someone you're
// already friends with - all three are the same "delete the row" operation.
friendsRouter.post('/:userId/decline', requireAuth, (req, res) => {
  const otherUserId = parseUserIdParam(req.params.userId);
  if (!otherUserId) return res.status(400).json({ error: 'משתמש לא תקין' });
  removeFriendship(req.user!.id, otherUserId);
  res.status(204).end();
});

// Profile stats and collection are only visible to the player themselves or
// an accepted friend - matching the explicit "friends can view each other's
// profile and collection" scope this was built for, not the open-to-anyone
// trust level the trade market and online-users list use.
function requireSelfOrFriend(viewerId: number, targetId: number): boolean {
  return viewerId === targetId || areFriends(viewerId, targetId);
}

friendsRouter.get('/:userId/profile', requireAuth, (req, res) => {
  const targetId = parseUserIdParam(req.params.userId);
  if (!targetId) return res.status(400).json({ error: 'משתמש לא תקין' });
  const target = findUserById(targetId);
  if (!target) return res.status(404).json({ error: 'משתמש לא קיים' });
  if (!requireSelfOrFriend(req.user!.id, targetId)) {
    return res.status(403).json({ error: 'ניתן לצפות בפרופיל רק של חברים' });
  }
  res.json({ displayName: target.display_name, stats: getUserStats(targetId) });
});

friendsRouter.get('/:userId/collection', requireAuth, (req, res) => {
  const targetId = parseUserIdParam(req.params.userId);
  if (!targetId) return res.status(400).json({ error: 'משתמש לא תקין' });
  if (!findUserById(targetId)) return res.status(404).json({ error: 'משתמש לא קיים' });
  if (!requireSelfOrFriend(req.user!.id, targetId)) {
    return res.status(403).json({ error: 'ניתן לצפות באוסף רק של חברים' });
  }
  res.json({ collection: getPokemonCollection(targetId) });
});
