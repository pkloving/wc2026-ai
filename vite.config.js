import { defineConfig } from 'vite';
import { resolve } from 'path';

const pages = [
  'index', 'schedule', 'standings', 'results',
  'predictions', 'stats', 'teams', 'about', 'bets',
  'match', 'contact', 'admin', 'simulate', 'backtest', 'pricing', '404', 'frequency',
];

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [],
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(
        pages.map((p) => [p, resolve(__dirname, `${p}.html`)]),
      ),
    },
  },
});
