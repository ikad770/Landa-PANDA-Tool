import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Required for GitHub Pages because the app may be served from /<repo-name>/.
  // Relative asset paths keep the build portable.
  base: './',
  server: {
    port: 5173,
    host: '0.0.0.0'
  }
});
