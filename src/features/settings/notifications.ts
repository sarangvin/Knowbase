// Daily reminders, client side: the browser's push subscription plus the
// account switch on the server (backend/src/routes/notifications.ts).
// Nothing is subscribed until the reader turns it on in Settings.
import { fromBootstrap } from '../../bootstrap'

export interface NotificationStatus {
  enabled: boolean
  /** Whether the one-time prompt (NotificationPrompt.tsx) has been answered. */
  prompted: boolean
  /** VAPID public key; null when the server is not set up to send. */
  publicKey: string | null
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function getNotificationStatus(): Promise<NotificationStatus> {
  const boot = await fromBootstrap<NotificationStatus>('notifications')
  if (boot) return boot
  const res = await fetch('/api/notifications', { credentials: 'include' })
  if (!res.ok) throw new Error(`Could not load notification settings (${res.status})`)
  return (await res.json()) as NotificationStatus
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function post(path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`/api/notifications/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) {
    const msg = await res.json().then((j: { error?: string }) => j.error).catch(() => null)
    throw new Error(msg || `Request failed (${res.status})`)
  }
  return res
}

export async function enableNotifications(publicKey: string): Promise<void> {
  if (!pushSupported()) {
    throw new Error('This browser cannot receive notifications. On iPhone, add Rabbithole to your home screen first.')
  }
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked for this site. Allow them in your browser settings and try again.')
  }
  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }))
  await post('subscribe', {
    subscription: sub.toJSON(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
}

export async function disableNotifications(): Promise<void> {
  // Server first: once it has forgotten every device, nothing more is sent
  // even if unsubscribing this browser fails.
  await post('unsubscribe')
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  const sub = await reg?.pushManager.getSubscription()
  await sub?.unsubscribe().catch(() => {})
}

export async function markPrompted(): Promise<void> {
  await post('prompted')
}

export async function sendTestNotification(): Promise<void> {
  await post('test')
}
