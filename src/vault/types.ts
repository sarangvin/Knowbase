// ─────────────────────────────────────────────────────────────────────────────
// Core data contract for the whole app. Every feature panel builds against these
// types and the VaultStore API (see vaultStore.ts). Keep this stable.
// ─────────────────────────────────────────────────────────────────────────────

/** A raw file entry as listed by a VaultSource (before parsing). */
export interface VaultFileMeta {
  /** POSIX-style path relative to the vault root, e.g. "Automated Graph/Today.md". */
  path: string
  type: 'note' | 'asset'
  /** lowercase extension without the dot, e.g. "md", "png". */
  ext: string
  size: number
  /** epoch millis; 0 if unknown. */
  mtime: number
}

/** A wikilink or embed occurrence found in note body or frontmatter. */
export interface LinkRef {
  /** The inside of the brackets, e.g. "Supply and Demand|aliased#Heading". */
  raw: string
  /** Link target before any #heading / |alias, e.g. "Supply and Demand". */
  target: string
  /** Optional display text after `|`. */
  alias?: string
  /** Optional #heading or #^block fragment (without the leading #). */
  heading?: string
  /** true for `![[...]]` embeds, false for `[[...]]` links. */
  embed: boolean
  /** Resolved absolute vault path, or null if the link is unresolved (dangling). */
  resolved: string | null
}

export interface Heading {
  level: number
  text: string
  /** slug id used for in-page anchors. */
  slug: string
}

/** A fully parsed note. */
export interface Note {
  /** Absolute vault path, e.g. "Automated Graph/Economics/Topics/.../Elasticity.md". */
  path: string
  /** Basename without extension, e.g. "Elasticity". Used for [[wikilink]] matching. */
  name: string
  /** Display title: frontmatter.title ?? first H1 ?? name. */
  title: string
  /** Parsed YAML frontmatter (empty object if none). */
  frontmatter: Record<string, unknown>
  /** Markdown body with frontmatter stripped. */
  body: string
  /** Original full file text. */
  raw: string
  /** Outgoing links + embeds, in document order. */
  links: LinkRef[]
  /** Tags from frontmatter `tags:` and inline `#tag` (without leading #). */
  tags: string[]
  /** Headings for outline / TOC. */
  headings: Heading[]
  mtime: number
}

/** The computed link/tag index across the whole vault. */
export interface VaultIndex {
  /** path -> Note */
  notes: Map<string, Note>
  /** lowercased basename -> path (for resolving [[Name]]). Last wins on collision. */
  nameToPath: Map<string, string>
  /** path -> set of paths that link TO it (backlinks). */
  backlinks: Map<string, Set<string>>
  /** path -> set of paths it links FROM (forward links, resolved only). */
  forwardlinks: Map<string, Set<string>>
  /** tag -> set of note paths carrying it. */
  tags: Map<string, Set<string>>
  /** unresolved link targets -> set of source note paths that reference them. */
  unresolved: Map<string, Set<string>>
}

/** Nodes for the graph view. */
export interface GraphData {
  nodes: { id: string; label: string; resolved: boolean; degree: number; tags: string[] }[]
  links: { source: string; target: string }[]
}

/** A node in the file-explorer tree. */
export interface TreeNode {
  name: string
  path: string
  type: 'folder' | 'note' | 'asset'
  children?: TreeNode[]
}
