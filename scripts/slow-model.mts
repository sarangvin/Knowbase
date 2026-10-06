// Live check that a slow (not erroring) primary model falls through to the next one inside the same deadline.
// Needs GEMINI_API_KEY and a local DATABASE_URL:  cd backend && npx tsx --env-file=.env ../scripts/slow-model.mts
// Expect: (1) answers via the second model after ~8s, (2) next call skips the benched primary, (3) all-hang ends in ModelTimeoutError at the deadline.
import { meteredGeminiCall, ModelTimeoutError } from '../backend/src/llm/meter.ts'
import { chainStatus } from '../backend/src/llm/models.ts'
const realFetch = globalThis.fetch
let hung = 0
// The primary never answers: it hangs until the caller aborts it.
globalThis.fetch = ((url: any, init: any) => {
  if (String(url).includes('models/gemini-3.5-flash-lite:')) {
    hung++
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  }
  return realFetch(url, init)
}) as typeof fetch
const key = process.env.GEMINI_API_KEY!
let t = Date.now()
const out = await meteredGeminiCall(key, 'Reply with one word.', 'Say hello.', { source: 'test', timeoutMs: 20_000 })
console.log('1. slow primary ->', JSON.stringify(out.trim()), `${((Date.now() - t) / 1000).toFixed(1)}s`, '| hung attempts:', hung)
console.log('   benched:', chainStatus().filter((c) => c.benchedUntil).map((c) => c.model))
t = Date.now()
const out2 = await meteredGeminiCall(key, 'Reply with one word.', 'Say bye.', { source: 'test', timeoutMs: 20_000 })
console.log('2. next call, primary benched ->', JSON.stringify(out2.trim()), `${((Date.now() - t) / 1000).toFixed(1)}s`, '| hung attempts:', hung)
// Every model hangs: the call's own deadline must still fire with a ModelTimeoutError.
globalThis.fetch = ((_u: any, init: any) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))) as typeof fetch
t = Date.now()
try { await meteredGeminiCall(key, 's', 'u', { source: 'test', timeoutMs: 6_000 }); console.log('3. UNEXPECTED success') }
catch (e) { console.log('3. everything hangs ->', (e as Error).constructor.name, `${((Date.now() - t) / 1000).toFixed(1)}s`, e instanceof ModelTimeoutError ? '(ModelTimeoutError, as expected)' : '') }
process.exit(0)
