import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server as SocketServer } from 'socket.io';
import { leaderboardRouter } from './routes/leaderboard.js';
import { authRouter } from './routes/auth.js';
import { progressRouter } from './routes/progress.js';
import { levelsRouter } from './routes/levels.js';
import { pokemonRouter } from './routes/pokemon.js';
import { registerRaceHandlers } from './race.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Reachable from the internet once deployed, not just localhost - a bare cors()
// would let any site on the internet ride the session cookie. Same allow-list
// pattern as RiseUp/NavalWarfare3D.
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:5180')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} not allowed`));
    },
    credentials: true,
  })
);
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/progress', progressRouter);
app.use('/api/levels', levelsRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/pokemon', pokemonRouter);

const port = Number(process.env.PORT) || 4000;
const certPath = path.join(dirname, '..', 'certs', 'cert.pem');
const keyPath = path.join(dirname, '..', 'certs', 'key.pem');

// HTTPS only in production (NODE_ENV set by ecosystem.config.js) - local dev stays
// plain HTTP even though the cert files are present in the repo, so `npm run dev`
// keeps working with the Vite proxy without a TLS handshake in the way. This app
// handles passwords and session cookies, so it always uses HTTPS once deployed -
// unlike the plain-HTTP game servers on this box that have no auth to protect.
const hasCert = process.env.NODE_ENV === 'production' && fs.existsSync(certPath) && fs.existsSync(keyPath);
const httpServer = hasCert
  ? https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app)
  : createHttpServer(app);

const io = new SocketServer(httpServer, { cors: { origin: allowedOrigins, credentials: true } });

registerRaceHandlers(io);

httpServer.listen(port, () => {
  console.log(`3Doku server listening on ${hasCert ? 'https' : 'http'}://localhost:${port}`);
});
