// In-memory per-user daily quota for the free tier. Deliberately not Redis —
// this is a single backend instance at personal-project scale; move to a
// shared store only once running more than one instance makes an in-memory
// counter actually wrong (counts would reset per-instance / not be shared).
import type { Request, Response, NextFunction } from 'express'

const FREE_DAILY_LIMIT = 50

const counts = new Map<string, { day: string; count: number }>()

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function freeTierRateLimit(req: Request, res: Response, next: NextFunction): void {
  const userId = req.user!.id
  const day = today()
  const entry = counts.get(userId)
  if (!entry || entry.day !== day) {
    counts.set(userId, { day, count: 1 })
    next()
    return
  }
  if (entry.count >= FREE_DAILY_LIMIT) {
    res.status(429).json({ error: `Free tier limit of ${FREE_DAILY_LIMIT} requests/day reached. Try again tomorrow, or add your own API key in Settings.` })
    return
  }
  entry.count++
  next()
}
