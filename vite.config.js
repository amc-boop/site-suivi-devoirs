import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: true, // accessible depuis le téléphone sur le même Wi-Fi
    port: 5173,
    proxy: { '/api': `http://localhost:${process.env.API_PORT || 3001}`, '/uploads': `http://localhost:${process.env.API_PORT || 3001}` },
  },
});
