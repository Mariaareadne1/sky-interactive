import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // three.js is most of the bundle, loaded once
  build: { chunkSizeWarningLimit: 1000 }, // ~255 kB gzipped
  server: {
    port: Number(process.env.PORT) || 5386,
    strictPort: true,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
} as Parameters<typeof defineConfig>[0]);
