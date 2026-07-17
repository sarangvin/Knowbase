// Minimal Server-Sent-Events line reader shared by both upstream providers
// (Anthropic and Groq both stream `data: {...}\n\n` frames, just with
// different JSON payload shapes — parsing that shape stays provider-specific).
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    for (const evt of events) {
      for (const line of evt.split('\n')) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data) yield data
      }
    }
  }
}
