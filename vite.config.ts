import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The site is a static build (GitHub Pages) and the API is a Cloudflare Worker
// on its own origin, so there is no dev proxy: point VITE_API_ORIGIN at the
// Worker to work against real data.
export default defineConfig({
  plugins: [react()],
  // GitHub Pages project sites live under /<repo>/; a custom domain stays at /.
  base: process.env.VITE_BASE_PATH || '/',
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: false },
});
