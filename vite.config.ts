import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// PORT=0 (common in managed shells) must not become the proxy target.
const configuredPort = Number(process.env.PORT);
const API_PORT = Number.isInteger(configuredPort) && configuredPort > 0 ? String(configuredPort) : '3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false },
      '/media': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false },
      '/avatars': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
