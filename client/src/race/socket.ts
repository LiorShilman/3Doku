import { io, type Socket } from 'socket.io-client';

// Same origin the REST API uses (client and server are different ports in
// production) - see api.ts's API_BASE for the identical reasoning.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

let socket: Socket | null = null;

/** One shared connection, created lazily on first use and kept alive across race screens (lobby -> countdown -> play -> results) rather than reconnecting for each. */
export function getRaceSocket(): Socket {
  if (!socket) {
    socket = io(API_BASE || undefined, { withCredentials: true });
  }
  return socket;
}
