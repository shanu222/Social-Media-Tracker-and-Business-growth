import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In local dev, /api is proxied to the backend so no CORS setup is needed
    proxy: { '/api': 'http://localhost:4000' },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], charts: ['recharts'] } },
    },
  },
});
