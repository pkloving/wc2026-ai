import { defineConfig } from 'vite';
import { resolve } from 'path';

const pages = [
  'index', 'matches', 'predictions', 'stats', 'teams', 'about', 'bets',
  'match', 'contact', 'admin', 'simulate', 'pricing', '404', 'frequency', 'lab',
];

// 老 URL 重定向 (本地 dev 不会读 vercel.json, 在这里挂上)
// 2026-07-08 导航精简: schedule/standings/results 合并为 matches.html, backtest 合并到 lab.html
const redirectMap = {
  '/schedule': '/matches.html#schedule',
  '/schedule.html': '/matches.html#schedule',
  '/standings': '/matches.html#standings',
  '/standings.html': '/matches.html#standings',
  '/results': '/matches.html#results',
  '/results.html': '/matches.html#results',
  '/backtest': '/lab.html',
  '/backtest.html': '/lab.html',
};

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [
    {
      name: 'wc-old-url-redirects',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url?.split('?')[0];
          if (url && redirectMap[url]) {
            res.statusCode = 301;
            res.setHeader('Location', redirectMap[url]);
            res.end();
            return;
          }
          next();
        });
      },
    },
  ],
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
