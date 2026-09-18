// Neon hands us connection strings with `sslmode=require`.
//
// pg-connection-string currently treats `require` (and `prefer`, and
// `verify-ca`) as `verify-full` — full certificate and hostname verification.
// pg v9 / pg-connection-string v3 will switch to libpq semantics, where
// `require` means "encrypt, but do not verify the certificate". That is a
// downgrade to a connection that TLS protects against eavesdropping but not
// against an active man-in-the-middle, and it would happen silently on a
// routine dependency bump. The deprecation warning every process prints today
// is the library asking us to state which behaviour we want.
//
// We want the strict one, so say so explicitly. Nothing changes today — this
// is the behaviour already in effect — it just stops being implicit, and stops
// the warning.
const STRICT = 'verify-full'

/** Modes the caller genuinely meant to be lax; left alone. */
const INTENTIONALLY_LAX = new Set(['disable', 'no-verify', 'allow'])

export function withStrictSsl(connectionString: string): string {
  try {
    const url = new URL(connectionString)
    const mode = url.searchParams.get('sslmode')
    // No sslmode at all is the local-Postgres case (plaintext over loopback);
    // forcing verification there would break every local setup.
    if (!mode || mode === STRICT || INTENTIONALLY_LAX.has(mode)) return connectionString
    url.searchParams.set('sslmode', STRICT)
    return url.toString()
  } catch {
    // Not URL-shaped (libpq keyword/value form, say) — hand it back untouched
    // rather than risk mangling a string that already works.
    return connectionString
  }
}
