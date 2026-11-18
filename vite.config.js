import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In the packaged app the page may only load its own files; AI/network calls happen in the main process.
const csp = {
  name: 'erad-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<!--csp-->',
      `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'none'">`,
    ),
};

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), csp],
  server: { port: +(process.env.ERAD_PORT || 5173), strictPort: true, host: '127.0.0.1', proxy: { '/api': `http://127.0.0.1:${process.env.ERAD_API_PORT || 5174}` } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
