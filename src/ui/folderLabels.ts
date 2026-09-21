// What the vault's top-level folders are called on screen.
//
// "Automated Graph" is the right name on disk — an exported vault should say
// how its notes were made, and Obsidian will show the real thing. It is the
// wrong name to read inside the app: it describes the machinery rather than
// the subject, and the tab that gets you there says Learn.
//
// A label, never a rename. Nothing here touches a path, and every lookup is
// on the *top* level only: a folder called "Automated Graph" nested inside a
// collection is somebody's own note folder and not ours to rename.
const TOP_LEVEL_LABELS: Record<string, string> = {
  'Automated Graph': 'Learn',
}

export function folderLabel(name: string): string {
  return TOP_LEVEL_LABELS[name] ?? name
}
