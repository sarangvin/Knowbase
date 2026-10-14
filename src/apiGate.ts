// One request first when the API has probably gone cold.
//
// Opening the app fires several API calls at once from different parts of
// it — streak, allowance, library suggestions, onboarding status. With no
// warm instance, Vercel boots one per concurrent request: three or four cold
// starts, each paid in boot CPU, to open the app once. So when nothing has
// come back from the API for a while, the first request goes alone and the
// rest wait for its response; by then an instance is warm and they share it.
//
// Released on the response's headers, not its body, and after RELEASE_MS
// regardless, so a slow first request (a model call) holds nothing up for
// long. Thinking the API is warm when it is not costs only what it cost
// before this existed.
const WARM_MS = 60_000
const RELEASE_MS = 3_000

let lastResponseAt = 0
let opening: Promise<void> | null = null

function isApi(input: RequestInfo | URL): boolean {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const url = new URL(raw, location.href)
  return url.origin === location.origin && /^\/(api|auth)\//.test(url.pathname)
}

export function installApiGate(): void {
  const fetchRaw = window.fetch.bind(window)
  const send: typeof fetch = (input, init) =>
    fetchRaw(input, init).then((res) => {
      lastResponseAt = Date.now()
      return res
    })

  window.fetch = async (input, init) => {
    if (!isApi(input)) return fetchRaw(input, init)

    if (opening) await opening
    else if (Date.now() - lastResponseAt > WARM_MS) {
      const first = send(input, init)
      opening = Promise.race([first.then(() => {}, () => {}), new Promise<void>((r) => setTimeout(r, RELEASE_MS))]).finally(
        () => (opening = null),
      )
      return first
    }
    return send(input, init)
  }
}
