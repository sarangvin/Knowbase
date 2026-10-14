// Service worker for the daily reminders (backend/src/notifications). It only
// shows what the server pushes and opens the app when one is tapped; it does
// not cache anything, so it cannot serve a stale build.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Rabbithole', {
      body: data.body || '',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      // One reminder at a time: a new one replaces yesterday's if it is still there.
      tag: 'rabbithole-daily',
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) return w.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
