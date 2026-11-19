import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 21072,
    proxy: {
      '/api': 'http://localhost:3001',
      '/v1': 'http://localhost:3001',
    },
  },
});
