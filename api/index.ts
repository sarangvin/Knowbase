/* Vercel serverless entry for the whole backend.
 *
 * vercel.json rewrites every /api/* and /auth/* request here, and Vercel
 * preserves the original URL, so the Express app's own routers ('/api/vaults',
 * '/auth', ...) still match exactly as they do when index.ts runs it as a
 * long-running server locally. One function rather than a file per route keeps
 * routing, middleware order (the raw-body billing webhook before express.json)
 * and the error handler in a single place.
 *
 * Imports the COMPILED backend: `npm run vercel-build` runs the backend's tsc
 * before Vercel traces this file, so ../backend/dist/app.js exists by then.
 */
import { createApp } from '../backend/dist/app.js'

export default createApp()
