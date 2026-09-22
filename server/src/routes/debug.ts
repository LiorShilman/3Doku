import { Router } from 'express';
import { requireAuth } from './auth.js';
import { logClientEvent } from '../db.js';

export const debugRouter = Router();

// Temporary - see db.ts's client_events table doc. Accepts any small JSON
// blob describing a store transition (gameStore.ts's logClientEvent calls
// it); logging is fire-and-forget from the client's side, so this never
// needs to be more than "did I get a well-formed event, yes or no".
debugRouter.post('/event', requireAuth, (req, res) => {
  const { event, data } = req.body as { event?: unknown; data?: unknown };
  if (typeof event !== 'string' || !event || event.length > 100) {
    return res.status(400).json({ error: 'invalid event' });
  }
  logClientEvent(req.user!.id, event, data ?? null);
  res.status(204).end();
});
