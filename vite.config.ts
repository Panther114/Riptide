import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Single-file build so dist/index.html can be opened directly from disk.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022', assetsInlineLimit: 100000000, chunkSizeWarningLimit: 4000 },
  server: { port: 5173, host: '127.0.0.1' },
});
