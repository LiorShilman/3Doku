import { Router, type Request, type Response, type NextFunction } from 'express';
import { serialize } from 'cookie';
import {
  createUser,
  findUserByEmail,
  createSession,
  findValidSessionUser,
  deleteSession,
  updateDisplayName,
  type UserRow,
} from '../db.js';
import {
  hashPassword,
  verifyPassword,
  generateSessionToken,
  sessionExpiryDate,
  getSessionTokenFromCookieHeader,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from '../auth.js';

export const authRouter = Router();

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

function getSessionToken(req: Request): string | undefined {
  return getSessionTokenFromCookieHeader(req.headers.cookie);
}

const secureCookies = process.env.NODE_ENV === 'production';

function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    'Set-Cookie',
    serialize(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    })
  );
}

function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    serialize(SESSION_COOKIE_NAME, '', { httpOnly: true, secure: secureCookies, path: '/', maxAge: 0 })
  );
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = getSessionToken(req);
  const user = token ? findValidSessionUser(token) : undefined;
  if (!user) {
    res.status(401).json({ error: 'not authenticated' });
    return;
  }
  req.user = user;
  next();
}

function publicUser(user: UserRow) {
  return { id: user.id, email: user.email, displayName: user.display_name };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

authRouter.post('/register', (req, res) => {
  const { email, password, displayName } = req.body as { email?: unknown; password?: unknown; displayName?: unknown };

  if (typeof email !== 'string' || !isValidEmail(email)) return res.status(400).json({ error: 'invalid email' });
  if (typeof password !== 'string' || password.length < 8)
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 24) : email.split('@')[0];

  if (findUserByEmail(email)) return res.status(409).json({ error: 'email already registered' });

  const user = createUser(email, hashPassword(password), name);
  const token = generateSessionToken();
  createSession(token, user.id, sessionExpiryDate());
  setSessionCookie(res, token);
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post('/login', (req, res) => {
  const { email, password } = req.body as { email?: unknown; password?: unknown };
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'email and password required' });
  }

  const user = findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }

  const token = generateSessionToken();
  createSession(token, user.id, sessionExpiryDate());
  setSessionCookie(res, token);
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', (req, res) => {
  const token = getSessionToken(req);
  if (token) deleteSession(token);
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.patch('/profile', requireAuth, (req, res) => {
  const { displayName } = req.body as { displayName?: unknown };
  const name = typeof displayName === 'string' ? displayName.trim() : '';
  if (!name) return res.status(400).json({ error: 'display name is required' });
  if (name.length > 24) return res.status(400).json({ error: 'display name must be 24 characters or fewer' });

  const user = updateDisplayName(req.user!.id, name);
  res.json({ user: publicUser(user) });
});

authRouter.get('/me', (req, res) => {
  const token = getSessionToken(req);
  const user = token ? findValidSessionUser(token) : undefined;
  if (!user) return res.status(401).json({ error: 'not authenticated' });
  res.json({ user: publicUser(user) });
});
