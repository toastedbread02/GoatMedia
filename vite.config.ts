import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The site is static and the API is a Cloudflare Worker on another origin, so
// there is no dev proxy: point VITE_API_ORIGIN at the deployed Worker to work
// against real data.
export default defineConfig({
  plugins: [react()],
  // GitHub Pages project sites live under /<repo>/; a custom domain stays at /.
  base: process.env.VITE_BASE_PATH || '/',
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: false },
});
