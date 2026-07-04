import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { apiMiddleware } from './server/api.mjs';

const devPort = Number(process.env.VITE_PORT || process.env.PORT || 5173);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || 'dev'),
  },
  plugins: [
    react(),
    {
      name: 'api-middleware',
      configureServer(server) {
        server.middlewares.use(apiMiddleware);
      },
    },
  ],
  server: {
    port: Number.isFinite(devPort) ? devPort : 5173,
  },
});
