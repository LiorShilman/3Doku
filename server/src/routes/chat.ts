import { Router } from 'express';
import { requireAuth } from './auth.js';
import { areFriends, findUserById, getConversation } from '../db.js';

export const chatRouter = Router();

function parseUserIdParam(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id >= 1 ? id : null;
}

// Read-only - sending goes through the socket (see presence.ts's
// notify:send, which persists every message it relays regardless of
// friendship or whether the recipient is currently online). This is just
// the dedicated chat page's way to load a conversation's history on open,
// restricted to friends (the always-available online-users panel stays open
// to anyone online, but this dedicated page is specifically for friends).
chatRouter.get('/:userId', requireAuth, (req, res) => {
  const otherUserId = parseUserIdParam(req.params.userId);
  if (!otherUserId) return res.status(400).json({ error: 'משתמש לא תקין' });
  if (!findUserById(otherUserId)) return res.status(404).json({ error: 'משתמש לא קיים' });
  if (!areFriends(req.user!.id, otherUserId)) return res.status(403).json({ error: 'ניתן לצ׳אט רק עם חברים' });
  res.json({ messages: getConversation(req.user!.id, otherUserId) });
});
