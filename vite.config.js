import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for the React SPA. The `api/` directory is deployed as
// Vercel serverless functions and is intentionally excluded from the client bundle.
//
// In LOCAL dev (runAppLocally.sh) the app runs against the bundled SQLite backend.
// We proxy `/local/*` (data protocol) and `/api/*` (privileged routes) to that
// backend so the frontend code is identical to production. This proxy is inert
// in production (Vite dev is not used there).
const localBackend = process.env.LOCAL_BACKEND_URL || 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/local': { target: localBackend, changeOrigin: true },
      '/api': { target: localBackend, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
