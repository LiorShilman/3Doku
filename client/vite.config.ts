import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// production build is served by IIS under /3Doku/ - dev server stays at root
// so `npm run dev` URLs don't change.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'production' ? '/3Doku/' : '/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
}));
