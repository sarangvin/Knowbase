// Cold starts, and what each server instance costs in CPU.
//
// The whole API is one Vercel function. Every time Vercel starts a fresh
// instance of it (a cold start), Node loads the entire app before the first
// request can be served, and that boot is billed as Active CPU like any other
// work. Vercel shows per-route CPU only on paid plans, and keeps runtime logs
// for 30 minutes on Hobby, so this records it ourselves: one row per
// instance in `function_instances`, shown in the admin Cold starts tab.
//
// Per instance:
//   boot_cpu_ms  CPU the process had used when its first request arrived —
//                Node's own startup plus importing the app. The cold start.
//   cpu_ms       CPU used by the whole process so far, boot included.
//                Written FLUSH_MS after the last request of a burst, so an
//                app open's eight requests cost one write, not eight.
//   requests     Requests served.
//
// Only on Vercel (or with TRACK_INSTANCES=1): a long-running local server is
// one instance for hours and says nothing about cold starts.
//
// Best-effort, like logUsageEvent: the writes happen after the response, and
// a failure is logged and dropped, never surfaced to the request.
import { randomUUID } from 'node:crypto'
import type { RequestHandler } from 'express'
import { waitUntil } from '@vercel/functions'
import { eq, lt, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { functionInstances } from '../db/schema.js'

const FLUSH_MS = 2_000
const KEEP_DAYS = 30

const enabled = process.env.VERCEL === '1' || process.env.TRACK_INSTANCES === '1'
const instanceId = randomUUID()
const cpuMs = () => {
  const u = process.cpuUsage()
  return Math.round((u.user + u.system) / 1000)
}

let requests = 0
let created: Promise<unknown> | null = null
let flushing: Promise<void> | null = null

function record(task: () => Promise<unknown>): void {
  const p = task().catch((err) => console.error('[instances] write failed', err))
  waitUntil(p)
}

export const trackInstance: RequestHandler = (req, res, next) => {
  if (!enabled) return next()
  requests++

  if (!created) {
    // Measured before this request does any work of its own.
    const bootCpuMs = cpuMs()
    const bootWallMs = Math.round(process.uptime() * 1000)
    const firstPath = req.path.slice(0, 200)
    created = new Promise<void>((resolve) => {
      res.on('finish', () => {
        record(async () => {
          try {
            await db.insert(functionInstances).values({
              id: instanceId,
              startedAt: new Date(Date.now() - bootWallMs),
              bootCpuMs,
              bootWallMs,
              firstPath,
              region: process.env.VERCEL_REGION ?? null,
              deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
              requests,
              cpuMs: cpuMs(),
            })
            // Housekeeping on the rare path, so it costs nothing per request.
            await db
              .delete(functionInstances)
              .where(lt(functionInstances.startedAt, sql`now() - make_interval(days => ${KEEP_DAYS})`))
          } finally {
            resolve()
          }
        })
      })
    })
    return next()
  }

  res.on('finish', () => {
    // One pending write covers every request that finishes before it runs;
    // it reads the counters when it fires, not when it was scheduled.
    if (flushing) return
    flushing = new Promise<void>((resolve) => setTimeout(resolve, FLUSH_MS)).then(async () => {
      flushing = null
      await created
      await db
        .update(functionInstances)
        .set({ requests, cpuMs: cpuMs(), lastRequestAt: new Date() })
        .where(eq(functionInstances.id, instanceId))
    })
    record(() => flushing!)
  })
  next()
}
