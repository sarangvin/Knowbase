/* Vercel serverless entry for the whole backend.
 *
 * vercel.json rewrites every /api/* and /auth/* request here, and Vercel
 * preserves the original URL, so the Express app's own routers ('/api/vaults',
 * '/auth', ...) still match exactly as they do when index.ts runs it as a
 * long-running server locally. One function rather than a file per route keeps
 * routing, middleware order (the raw-body billing webhook before express.json)
 * and the error handler in a single place.
 *
 * Imports the BUNDLED backend: `npm run vercel-build` runs the backend's build
 * (tsc, then esbuild) before Vercel traces this file, so
 * ../backend/dist/app.bundle.js exists by then. One file rather than tsc's
 * output plus node_modules: the unbundled app loaded about 530 modules on
 * every cold start, and resolving and reading them was most of the ~1.3 s of
 * boot CPU each instance paid before serving its first request.
 */
import { createApp } from '../backend/dist/app.bundle.js'

export default createApp()
