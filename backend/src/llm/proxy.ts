// Shared streaming passthrough: pipes a provider's text-chunk generator
// straight to the HTTP response as it arrives. Every LLM call, regardless of
// tier, goes through here — the one place M5's usage_events logging gets
// added later (wrap the loop below with a token/latency-counting write).
import type { Response } from 'express'

export async function pipeTextStream(res: Response, gen: AsyncGenerator<string>): Promise<void> {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  try {
    for await (const chunk of gen) {
      res.write(chunk)
    }
    res.end()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'stream failed'
    if (!res.headersSent) {
      res.status(502).json({ error: message })
    } else {
      // Response already started streaming — can't send a clean JSON error
      // mid-body, so just end it; the client's partial text plus a thrown
      // error from the fetch reject is the best signal it gets.
      res.end()
    }
  }
}
