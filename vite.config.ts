import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Frontend and API are served from one Vercel origin, so assets sit at the
  // root and session cookies stay same-site. (This was '/Knowbase/' while the
  // app was on GitHub Pages, which served it from a repo-name subpath.)
  base: '/',
  build: {
    rollupOptions: {
      // admin.html is a deliberately separate bundle from the main app (own
      // entry, own route, requireOwner-gated) — not woven into App.tsx, which
      // has no router and no business rendering an admin surface.
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
  server: {
    proxy: {
      // Same-origin in dev so session cookies behave like the planned
      // same-site production setup, instead of needing SameSite=None.
      '/api': 'http://localhost:8787',
      '/auth': 'http://localhost:8787',
    },
  },
})
