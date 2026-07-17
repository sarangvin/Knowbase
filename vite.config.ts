import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves this repo at https://<user>.github.io/Knowbase/,
  // so all asset URLs must be prefixed with the repo name. NOTE: per the
  // multi-tenant plan, production hosting moves off GitHub Pages onto a
  // same-site subdomain alongside the backend (so session cookies aren't
  // cross-site) — this `base` goes back to '/' once that migration happens.
  base: '/Knowbase/',
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
