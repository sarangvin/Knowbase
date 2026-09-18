// Minimal Server-Sent-Events line reader shared by every upstream provider
// (Anthropic and Google both stream `data: {...}` frames, just with different
// JSON payload shapes — parsing that shape stays provider-specific).
//
// Two things here are not incidental:
//
//  1. CRLF. The spec allows CRLF, LF or CR as line terminators, and Google's
//     generativelanguage endpoint uses CRLF — so an event separator is
//     "\r\n\r\n", not "\n\n". Splitting on "\n\n" alone matched nothing
//     there: the whole response accumulated in `buffer` and every frame was
//     silently lost, producing a clean HTTP 200 with an empty body and no
//     error anywhere to explain it. Normalising first keeps the split rule
//     to one case.
//
//  2. The flush after the loop. A stream that ends without a trailing blank
//     line leaves its last event sitting in `buffer`; dropping it loses the
//     final chunk of every response that isn't terminated exactly right.
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  function* drain(block: string): Generator<string> {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data) yield data
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    // Normalise CR and CRLF to LF before any splitting, so the separator and
    // line rules below only ever deal with "\n".
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n')
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''
    for (const evt of events) yield* drain(evt)
  }

  // Trailing decoder state, then whatever never got its blank line.
  buffer += decoder.decode().replace(/\r\n?/g, '\n')
  if (buffer.trim()) yield* drain(buffer)
}
