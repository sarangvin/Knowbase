// Archiving and deleting a collection. Both are server-owned: the flag lives
// in the space's own `_config.md` and the delete is a scoped DELETE, so the
// client asks and then reloads rather than editing the vault itself.
async function jsonOrThrow(res: Response): Promise<unknown> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function setCollectionArchived(space: string, archived: boolean): Promise<void> {
  const res = await fetch('/api/vaults/mine/space/archive', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ space, archived }),
  })
  await jsonOrThrow(res)
}

export interface DeleteResult {
  deletedNotes: number
  cancelledJobs: number
  forgottenCards: number
}

export async function deleteCollection(space: string): Promise<DeleteResult> {
  const res = await fetch(`/api/vaults/mine/space?space=${encodeURIComponent(space)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  return (await jsonOrThrow(res)) as DeleteResult
}

/** For Settings, which wants the list without having to hold a vault index. */
export async function fetchArchivedCollections(): Promise<string[]> {
  const res = await fetch('/api/vaults/mine/spaces/archived', { credentials: 'include' })
  return ((await jsonOrThrow(res)) as { archived: string[] }).archived
}
