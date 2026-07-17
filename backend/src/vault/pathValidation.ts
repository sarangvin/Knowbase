// Every note/asset path that reaches a DB query or (later) an S3 key must pass
// through here first. Defense-in-depth: paths are matched against `(vault_id,
// path)` rows, not real filesystem paths, so traversal can't read arbitrary
// host files — but a bad path could still collide with another vault's rows
// once storage keys are derived from it, and it keeps behavior consistent
// with FsAccessVaultSource's real-filesystem semantics on the client.
export function validateVaultPath(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) throw new PathError('empty path')
  if (raw.includes('\0')) throw new PathError('null byte in path')
  if (raw.startsWith('/')) throw new PathError('absolute path not allowed')
  const parts = raw.split('/')
  if (parts.some((p) => p === '..' || p === '.')) throw new PathError('path traversal segment')
  if (parts.some((p) => p.length === 0)) throw new PathError('empty path segment')
  return raw
}

export class PathError extends Error {}
