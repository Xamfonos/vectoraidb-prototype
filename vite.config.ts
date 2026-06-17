import { defineConfig } from 'vite';

// Static single-page prototype. `public/` (fonts) is copied to the build root as-is.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
});
