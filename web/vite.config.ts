import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.PORT || 8787}`,
        changeOrigin: true,
      },
    },
  },
});
