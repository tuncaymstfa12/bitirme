import { defineConfig } from 'vite';

const frontendPort = Number(process.env.FRONTEND_PORT || 4173);
const backendPort = Number(process.env.BACKEND_PORT || 8100);

export default defineConfig({
  server: {
    port: frontendPort,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: process.env.DOCKER ? `http://backend:${backendPort}` : `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
