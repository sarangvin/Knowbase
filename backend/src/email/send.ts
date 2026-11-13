// Outgoing email over SMTP. Dormant until SMTP_URL and EMAIL_FROM are set,
// like the other optional integrations: the app boots and every pass reports
// "off" without them.
//
//   SMTP_URL     e.g. smtps://you%40gmail.com:<app password>@smtp.gmail.com:465
//   EMAIL_FROM   e.g. "Rabbithole <you@gmail.com>"
//   EMAIL_SECRET signs unsubscribe links (falls back to CRON_SECRET)
//
// nodemailer is imported lazily: every import on the request path is paid on
// every cold start (see the CPU budget note in the deployment docs).
import { createHmac, timingSafeEqual } from 'node:crypto'

export function emailConfigured(): boolean {
  return Boolean(process.env.SMTP_URL && process.env.EMAIL_FROM && unsubSecret())
}

function unsubSecret(): string | undefined {
  return process.env.EMAIL_SECRET || process.env.CRON_SECRET || undefined
}

/** A token that proves an unsubscribe link was issued for this user, so a
 *  link cannot be edited into somebody else's opt-out. */
export function unsubToken(userId: string): string {
  return createHmac('sha256', unsubSecret() ?? '').update(`unsub:${userId}`).digest('base64url')
}

export function validUnsubToken(userId: string, token: string): boolean {
  if (!unsubSecret()) return false
  const a = Buffer.from(unsubToken(userId))
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function appUrl(): string {
  return (process.env.APP_URL ?? 'https://rabbithole-topaz.vercel.app').replace(/\/$/, '')
}

export function unsubUrl(userId: string): string {
  return `${appUrl()}/api/email/unsubscribe?u=${userId}&t=${unsubToken(userId)}`
}

export interface Email {
  to: string
  subject: string
  text: string
  html: string
  userId: string
}

type Transport = { sendMail: (m: Record<string, unknown>) => Promise<unknown> }
let transport: Transport | null = null

export async function sendEmail(e: Email): Promise<void> {
  if (!emailConfigured()) throw new Error('email is not configured')
  if (!transport) {
    const nodemailer = await import('nodemailer')
    transport = nodemailer.createTransport(process.env.SMTP_URL!) as unknown as Transport
  }
  const unsub = unsubUrl(e.userId)
  await transport.sendMail({
    from: process.env.EMAIL_FROM,
    to: e.to,
    subject: e.subject,
    text: e.text,
    html: e.html,
    // One-click unsubscribe in the mail client's own UI (RFC 8058): Gmail
    // shows an "Unsubscribe" button next to the sender for these.
    headers: {
      'List-Unsubscribe': `<${unsub}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  })
}
