// Shared by every provider that proxies through knowbase-backend (BYO and
// free tiers) — the backend streams plain UTF-8 text chunks (see
// backend/src/llm/proxy.ts), so reading it back is just decode-and-append.
export async function streamFromBackend(
  url: string,
  body: unknown,
  onDelta?: (text: string) => void,
): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok || !res.body) {
    let message = `Request failed: ${res.status}`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    full += chunk
    onDelta?.(chunk)
  }
  return full
}
