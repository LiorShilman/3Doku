import type { Server as SocketServer, Socket } from 'socket.io';
import { generatePuzzleForLevel, isSolved, type Position, type PuzzleDefinition } from '@3doku/shared';
import { findValidSessionUser, recordRaceResult, type UserRow } from './db.js';
import { getSessionTokenFromCookieHeader } from './auth.js';

interface RacePlayer {
  socketId: string;
  userId: number;
  displayName: string;
  finished: boolean;
  timeMs: number | null;
  disconnectTimer?: NodeJS.Timeout;
}

// A phone backgrounding its browser tab (switching apps to share the room
// code, screen lock, a brief wifi/cellular handoff) drops the socket, and
// socket.io-client reconnects automatically with a NEW socket id moments
// later. Without a grace window, that disconnect alone would delete a
// 'waiting' room out from under its own creator before their friend even
// gets to type the code in.
const DISCONNECT_GRACE_MS = 30000;

const MAX_RACE_PLAYERS = 4;
const MIN_RACE_PLAYERS_TO_START = 2;

interface RaceRoom {
  code: string;
  puzzle: PuzzleDefinition;
  size: number;
  players: RacePlayer[];
  status: 'waiting' | 'racing' | 'finished';
  startedAt: number | null;
  hostUserId: number;
}

// In-memory only - a race room is a short-lived, throwaway session (a few
// minutes at most), not something worth persisting across a server restart
// or surviving in the database the way levels/progress/scores do.
const rooms = new Map<string, RaceRoom>();

// Excludes visually-ambiguous characters (0/O, 1/I) since a player has to
// read this off one screen and type it into another.
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRoomCode(): string {
  let code: string;
  do {
    code = Array.from({ length: 5 }, () => ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// Races aren't tied to level progression, but reuse the same generator - each
// board size just maps to the level range that produces it under the
// standard ramp (sizeForLevel: 5 + floor((level-1)/13), capped at 9). Picking
// a random level within a size's range gives a fresh board of that size
// every time without needing a separate generation path.
const SIZE_LEVEL_RANGES: Record<number, [number, number]> = {
  5: [1, 13],
  6: [14, 26],
  7: [27, 39],
  8: [40, 52],
  9: [53, 65],
};
const DEFAULT_RACE_SIZE = 7;

function generateRacePuzzle(size: number): PuzzleDefinition {
  const [min, max] = SIZE_LEVEL_RANGES[size] ?? SIZE_LEVEL_RANGES[DEFAULT_RACE_SIZE];
  const level = min + Math.floor(Math.random() * (max - min + 1));
  return generatePuzzleForLevel(level);
}

function authenticate(socket: Socket): UserRow | null {
  const token = getSessionTokenFromCookieHeader(socket.handshake.headers.cookie);
  const user = token ? findValidSessionUser(token) : undefined;
  return user ?? null;
}

function findRoomBySocket(socketId: string): RaceRoom | undefined {
  for (const room of rooms.values()) {
    if (room.players.some((p) => p.socketId === socketId)) return room;
  }
  return undefined;
}

function findRoomByUserId(userId: number): { room: RaceRoom; player: RacePlayer } | undefined {
  for (const room of rooms.values()) {
    const player = room.players.find((p) => p.userId === userId);
    if (player) return { room, player };
  }
  return undefined;
}

function publicPlayer(p: RacePlayer) {
  return { userId: p.userId, displayName: p.displayName, finished: p.finished, timeMs: p.timeMs };
}

function cleanupRoom(room: RaceRoom) {
  if (room.players.length === 0) rooms.delete(room.code);
}

// If the departing player was host, hand it to whoever's been in the room
// longest (index 0) - only matters while still 'waiting', since that's the
// only phase where "host" grants a privilege (starting the race).
function reassignHostIfNeeded(room: RaceRoom): void {
  if (room.players.length === 0) return;
  if (room.players.some((p) => p.userId === room.hostUserId)) return;
  room.hostUserId = room.players[0].userId;
}

function broadcastRoster(io: SocketServer, room: RaceRoom): void {
  io.to(room.code).emit('race:roster', {
    players: room.players.map(publicPlayer),
    hostUserId: room.hostUserId,
  });
}

// Tallies this race into each participant's running win/played count (see
// db.ts's race_stats table) - the room itself is thrown away right after, so
// this is the only trace of the race that outlives it.
function persistRaceResult(room: RaceRoom): void {
  const participantUserIds = room.players.map((p) => p.userId);
  if (participantUserIds.length === 0) return;
  const finishers = room.players.filter((p) => p.finished && p.timeMs !== null);
  const winner = finishers.reduce<RacePlayer | null>(
    (best, p) => (best === null || p.timeMs! < best.timeMs! ? p : best),
    null
  );
  recordRaceResult(participantUserIds, winner?.userId ?? null);
}

export function registerRaceHandlers(io: SocketServer): void {
  io.on('connection', (socket) => {
    const user = authenticate(socket);

    // Rebind a reconnecting player to their still-alive room instead of
    // letting them silently fall out of it - see DISCONNECT_GRACE_MS above.
    if (user) {
      const existing = findRoomByUserId(user.id);
      if (existing?.player.disconnectTimer) {
        clearTimeout(existing.player.disconnectTimer);
        existing.player.disconnectTimer = undefined;
        existing.player.socketId = socket.id;
        socket.join(existing.room.code);
      }
    }

    socket.on('race:create', (data: { size?: unknown }, ack?: (res: { code: string } | { error: string }) => void) => {
      if (!user) return ack?.({ error: 'not authenticated' });
      const size =
        typeof data?.size === 'number' && data.size in SIZE_LEVEL_RANGES ? data.size : DEFAULT_RACE_SIZE;
      const code = generateRoomCode();
      const room: RaceRoom = {
        code,
        puzzle: generateRacePuzzle(size),
        size,
        players: [{ socketId: socket.id, userId: user.id, displayName: user.display_name, finished: false, timeMs: null }],
        status: 'waiting',
        startedAt: null,
        hostUserId: user.id,
      };
      rooms.set(code, room);
      socket.join(code);
      ack?.({ code });
    });

    socket.on('race:join', (data: { code?: unknown }, ack?: (res: { ok: true } | { error: string }) => void) => {
      if (!user) return ack?.({ error: 'not authenticated' });
      const code = typeof data?.code === 'string' ? data.code.toUpperCase().trim() : '';
      const room = rooms.get(code);
      if (!room) return ack?.({ error: 'החדר לא נמצא' });
      if (room.status !== 'waiting') return ack?.({ error: 'המרוץ כבר התחיל' });
      if (room.players.length >= MAX_RACE_PLAYERS) return ack?.({ error: 'החדר מלא' });
      if (room.players.some((p) => p.userId === user.id)) return ack?.({ error: 'אתה כבר בחדר הזה' });

      room.players.push({ socketId: socket.id, userId: user.id, displayName: user.display_name, finished: false, timeMs: null });
      socket.join(code);
      ack?.({ ok: true });

      // No auto-start any more - the host decides when everyone's in (race:begin).
      broadcastRoster(io, room);
    });

    socket.on('race:begin', (data: { code?: unknown }, ack?: (res: { ok: true } | { error: string }) => void) => {
      if (!user) return ack?.({ error: 'not authenticated' });
      const code = typeof data?.code === 'string' ? data.code : '';
      const room = rooms.get(code);
      if (!room) return ack?.({ error: 'החדר לא נמצא' });
      if (room.hostUserId !== user.id) return ack?.({ error: 'רק היוזם יכול להתחיל את המרוץ' });
      if (room.status !== 'waiting') return ack?.({ error: 'המרוץ כבר התחיל' });
      if (room.players.length < MIN_RACE_PLAYERS_TO_START) return ack?.({ error: 'צריך לפחות 2 שחקנים' });

      // Start a few seconds out so every client's own local clock (however
      // slightly out of sync) still agrees on one shared `startedAt` to count
      // down to and measure elapsed time against, without the server needing
      // its own setTimeout to fire an extra event.
      room.status = 'racing';
      room.startedAt = Date.now() + 3000;
      io.to(code).emit('race:start', {
        puzzle: room.puzzle,
        startedAt: room.startedAt,
        players: room.players.map(publicPlayer),
      });
      ack?.({ ok: true });
    });

    // Re-establishes a client that navigated away (to the home menu) and came
    // back, or reloaded the page entirely - either way the room and its
    // socket.io membership are unaffected (or, for a real reload, this is
    // what rebinds the brand-new socket to the same seat, same as the
    // disconnect-grace path above but without waiting for a disconnect event
    // to have fired at all).
    socket.on(
      'race:resync',
      (
        data: { code?: unknown },
        ack?: (
          res:
            | {
                ok: true;
                puzzle: PuzzleDefinition;
                startedAt: number | null;
                status: RaceRoom['status'];
                players: ReturnType<typeof publicPlayer>[];
                hostUserId: number;
              }
            | { error: string }
        ) => void
      ) => {
        if (!user) return ack?.({ error: 'not authenticated' });
        const code = typeof data?.code === 'string' ? data.code : '';
        const room = rooms.get(code);
        if (!room) return ack?.({ error: 'room gone' });
        const player = room.players.find((p) => p.userId === user.id);
        if (!player) return ack?.({ error: 'not a member of this room' });

        player.socketId = socket.id;
        if (player.disconnectTimer) {
          clearTimeout(player.disconnectTimer);
          player.disconnectTimer = undefined;
        }
        socket.join(code);

        ack?.({
          ok: true,
          puzzle: room.puzzle,
          startedAt: room.startedAt,
          status: room.status,
          players: room.players.map(publicPlayer),
          hostUserId: room.hostUserId,
        });
      }
    );

    // Host-only "play again" from the results screen - same room, same
    // players (minus anyone who's actually gone by now), a freshly generated
    // board of the same size, straight back into a countdown without
    // re-lobbying through create/join.
    socket.on('race:rematch', (data: { code?: unknown }, ack?: (res: { ok: true } | { error: string }) => void) => {
      if (!user) return ack?.({ error: 'not authenticated' });
      const code = typeof data?.code === 'string' ? data.code : '';
      const room = rooms.get(code);
      if (!room) return ack?.({ error: 'החדר לא נמצא' });
      if (room.hostUserId !== user.id) return ack?.({ error: 'רק היוזם יכול להתחיל משחק נוסף' });
      if (room.status !== 'finished') return ack?.({ error: 'המרוץ עדיין לא הסתיים' });

      room.players = room.players.filter((p) => !p.disconnectTimer);
      if (room.players.length < MIN_RACE_PLAYERS_TO_START) return ack?.({ error: 'צריך לפחות 2 שחקנים' });

      for (const p of room.players) {
        p.finished = false;
        p.timeMs = null;
      }
      room.puzzle = generateRacePuzzle(room.size);
      room.status = 'racing';
      room.startedAt = Date.now() + 3000;
      io.to(code).emit('race:start', {
        puzzle: room.puzzle,
        startedAt: room.startedAt,
        players: room.players.map(publicPlayer),
      });
      ack?.({ ok: true });
    });

    socket.on('race:progress', (data: { code?: unknown; placedCount?: unknown }) => {
      const code = typeof data?.code === 'string' ? data.code : '';
      const room = rooms.get(code);
      if (!room || room.status !== 'racing') return;
      if (typeof data?.placedCount !== 'number') return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) return;
      socket.to(code).emit('race:opponentProgress', { displayName: player.displayName, placedCount: data.placedCount });
    });

    socket.on(
      'race:finish',
      (data: { code?: unknown; positions?: unknown }, ack?: (res: { ok: true } | { error: string }) => void) => {
        const code = typeof data?.code === 'string' ? data.code : '';
        const room = rooms.get(code);
        if (!room || room.status !== 'racing' || room.startedAt === null) return ack?.({ error: 'no active race' });
        const player = room.players.find((p) => p.socketId === socket.id);
        if (!player || player.finished) return ack?.({ error: 'not in this race' });

        const positions = data.positions as Position[];
        if (!Array.isArray(positions) || !isSolved(room.puzzle, positions)) {
          return ack?.({ error: 'הפתרון שגוי' });
        }

        player.finished = true;
        player.timeMs = Date.now() - room.startedAt;
        ack?.({ ok: true });

        const place = room.players.filter((p) => p.finished).length;
        io.to(code).emit('race:playerFinished', {
          userId: player.userId,
          displayName: player.displayName,
          timeMs: player.timeMs,
          place,
        });

        // A player mid-disconnect-grace (see DISCONNECT_GRACE_MS) is gone in
        // every way that matters here - don't make the finisher wait out the
        // rest of that window with no feedback just because a truly-departed
        // opponent's slot hasn't been pruned yet.
        const activePlayers = room.players.filter((p) => !p.disconnectTimer);
        if (activePlayers.every((p) => p.finished) || activePlayers.length <= 1) {
          room.status = 'finished';
          io.to(code).emit('race:complete', { players: room.players.map(publicPlayer) });
          persistRaceResult(room);
        }
      }
    );

    socket.on('race:leave', (data: { code?: unknown }) => {
      const code = typeof data?.code === 'string' ? data.code : '';
      const room = rooms.get(code);
      if (!room) return;
      const player = room.players.find((p) => p.socketId === socket.id);
      room.players = room.players.filter((p) => p.socketId !== socket.id);
      socket.leave(code);
      if (room.status === 'racing' && room.players.length === 1) {
        room.status = 'finished';
        io.to(code).emit('race:playerLeft', { displayName: player?.displayName });
        persistRaceResult(room);
      } else if (room.status === 'waiting' && room.players.length > 0) {
        reassignHostIfNeeded(room);
        broadcastRoster(io, room);
      }
      cleanupRoom(room);
    });

    socket.on('disconnect', () => {
      const room = findRoomBySocket(socket.id);
      if (!room) return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) return;

      player.disconnectTimer = setTimeout(() => {
        room.players = room.players.filter((p) => p.socketId !== player.socketId);
        if (room.status === 'racing' && room.players.length === 1) {
          room.status = 'finished';
          io.to(room.code).emit('race:playerLeft', { displayName: player.displayName });
          persistRaceResult(room);
        } else if (room.status === 'waiting' && room.players.length > 0) {
          reassignHostIfNeeded(room);
          broadcastRoster(io, room);
        }
        cleanupRoom(room);
      }, DISCONNECT_GRACE_MS);
    });
  });
}
