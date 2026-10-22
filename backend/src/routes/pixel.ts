// POST /api/pixel/:name — the browser's half of the funnel (usage/pixel.ts).
//
// Unauthenticated, because the checkpoints that matter most happen before
// there is an account. Narrow for the same reason as /api/demo/visit: the
// name must be one of a fixed list, nothing else from the request is stored,
// and it shares that endpoint's per-IP limit. No body, so the client can use
// navigator.sendBeacon, which survives the redirect to Google.
import { Router } from 'express'
import { CLIENT_PIXELS, firePixel, type PixelName } from '../usage/pixel.js'
import { rateLimited } from './demo.js'

export const pixelRouter = Router()

const allowed = new Set<string>(CLIENT_PIXELS)

pixelRouter.post('/:name', (req, res) => {
  const name = req.params.name
  if (!allowed.has(name)) {
    res.status(400).json({ error: 'unknown pixel' })
    return
  }
  const fwd = req.headers['x-forwarded-for']
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.ip || 'unknown'
  res.status(204).end()
  if (!rateLimited(ip)) firePixel(name as PixelName)
})
