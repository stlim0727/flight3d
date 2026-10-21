import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      ignored: [
        '**/*.png',
        '**/*.jpg',
        '**/*.jpeg',
        '**/.chrome-profile/**',
        '**/.worktrees/**',
        '**/scripts/**'
      ]
    }
  }
});
