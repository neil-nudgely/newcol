import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths so the build works from any Pages subpath
  base: './',
  server: { port: 5173 },
  build: { outDir: 'dist' },
});
