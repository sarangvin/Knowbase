// Local workaround only: this machine's system resolver has stopped resolving
// the Neon host while public resolvers still do. Resolve via 1.1.1.1 and
// connect by IP, keeping servername so TLS still verifies the real hostname.
import { Resolver } from 'node:dns/promises'
import { Pool } from 'pg'

export async function makePool() {
  const u = new URL(process.env.DATABASE_URL)
  const r = new Resolver()
  r.setServers(['1.1.1.1', '8.8.8.8'])
  const [ip] = await r.resolve4(u.hostname)
  return new Pool({
    host: ip,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    ssl: { servername: u.hostname, rejectUnauthorized: true },
    max: 1,
  })
}
