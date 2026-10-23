import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** The pack files are gzip-compressed MVT. Static hosts need this header too. */
function mvtGzip(): Plugin {
  const middleware = (req: any, res: any, next: () => void) => {
    if (typeof req.url === 'string' && req.url.split('?')[0].endsWith('.mvt')) {
      res.setHeader('Content-Encoding', 'gzip');
    }
    next();
  };
  return {
    name: 'yanlu-mvt-gzip',
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}

export default defineConfig({
  plugins: [react(), mvtGzip()],
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: { host: '0.0.0.0', port: 5173 },
  preview: { host: '0.0.0.0', port: 4173 },
  build: { target: 'es2020' },
});
