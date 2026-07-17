// Best-effort telemetry: a failure here must never break the actual request
// it's describing (the user already got their note saved / answer streamed
// by the time this runs) — log and swallow, don't throw into the caller.
import { db } from '../db/client.js'
import { usageEvents } from '../db/schema.js'

export interface UsageEvent {
  userId: string
  eventType: 'login' | 'vault_sync' | 'note_write' | 'llm_call'
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
  metadata?: Record<string, unknown>
}

export async function logUsageEvent(event: UsageEvent): Promise<void> {
  try {
    await db.insert(usageEvents).values({
      userId: event.userId,
      eventType: event.eventType,
      provider: event.provider,
      model: event.model,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      latencyMs: event.latencyMs,
      metadata: event.metadata,
    })
  } catch (err) {
    console.error('Failed to log usage event', event.eventType, err)
  }
}
