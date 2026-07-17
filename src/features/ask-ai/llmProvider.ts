// Shared shape for every "Ask AI" backend: local Ollama, your own Anthropic
// key (proxied), or the free hosted Gemma tier (proxied). AskPanel/SyncModal
// only ever talk to this interface, never to a specific provider's module.
import type { Note } from '../../vault/types'

export interface LlmProvider {
  id: 'ollama' | 'anthropic' | 'free' | 'pro'
  label: string
  /** Optional model list for providers that support choosing one (Ollama only, today). */
  listModels?(): Promise<string[]>
  /** Whether this provider can be used right now, and why not if it can't. */
  checkReady?(): Promise<{ ready: boolean; message?: string }>
  streamChat(system: string, user: string, opts: { model?: string; onDelta?: (text: string) => void }): Promise<string>
}

export const TUTOR_SYSTEM = `You are a knowledgeable, concise tutor inside a personal knowledge base (an
Obsidian-style learning vault). The user is studying a topic and asks a question about it.
Answer directly and accurately, like a sharp study companion: explain the concept, use a
concrete example when it helps, and connect it to related ideas in the note when relevant.
Use Markdown. Do not restate the question. Keep it focused — a few tight paragraphs.
Do not use LaTeX or math notation (no $, \\text{}, \\frac{}) — this renders as plain Markdown,
so write formulas and variables in plain text instead, e.g. "MSC = MPC + external cost".`

export function buildTutorPrompt(note: Note, question: string): { system: string; user: string } {
  const context =
    `Note title: ${note.title}\nTags: ${note.tags.join(', ') || '(none)'}\n\n` +
    `--- NOTE CONTENT ---\n${note.body.slice(0, 12000)}\n--- END NOTE ---`
  return {
    system: TUTOR_SYSTEM,
    user: `Here is the note I'm studying, for context:\n\n${context}\n\nMy question: ${question}`,
  }
}

/** Ask a provider about a note — the one place the tutor prompt gets built, shared by every provider. */
export async function answerQuestion(
  provider: LlmProvider,
  note: Note,
  question: string,
  model?: string,
  onDelta?: (text: string) => void,
): Promise<string> {
  const { system, user } = buildTutorPrompt(note, question)
  return provider.streamChat(system, user, { model, onDelta })
}
