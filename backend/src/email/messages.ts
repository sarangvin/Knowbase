// The two onboarding emails. Plain, short, one link each, and an unsubscribe
// line in every one.

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function firstName(name: string | null): string {
  const n = (name ?? '').trim().split(/\s+/)[0]
  return n ? n : 'there'
}

function layout(paragraphs: string[], cta: { label: string; url: string }, unsub: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f4ef;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#222">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
${paragraphs.map((p) => `<p style="font-size:16px;line-height:1.5;margin:0 0 16px">${p}</p>`).join('\n')}
<p style="margin:24px 0"><a href="${esc(cta.url)}" style="display:inline-block;background:#222;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:16px">${esc(cta.label)}</a></p>
<p style="font-size:13px;color:#888;margin:24px 0 0">You're getting this because you signed up to Rabbithole. <a href="${esc(unsub)}" style="color:#888">Unsubscribe</a> and we won't email you again.</p>
</div></body></html>`
}

export function readyEmail(o: { name: string | null; space: string; url: string; unsub: string }) {
  const hi = `Hi ${esc(firstName(o.name))},`
  const body = `Your <strong>${esc(o.space)}</strong> collection is ready. The first notes are written and waiting, each one a few minutes of reading.`
  return {
    subject: `Your ${o.space} collection is ready`,
    html: layout([hi, body], { label: 'Start reading', url: o.url }, o.unsub),
    text: `Hi ${firstName(o.name)},\n\nYour ${o.space} collection is ready. The first notes are written and waiting, each one a few minutes of reading.\n\nStart reading: ${o.url}\n\nUnsubscribe: ${o.unsub}`,
  }
}

export function nextNoteEmail(o: { name: string | null; space: string; title: string; url: string; unsub: string }) {
  const hi = `Hi ${esc(firstName(o.name))},`
  const body = `Next up in <strong>${esc(o.space)}</strong>: <strong>${esc(o.title)}</strong>. Pick up where you left off, it takes a few minutes.`
  return {
    subject: `Next up: ${o.title}`,
    html: layout([hi, body], { label: 'Continue learning', url: o.url }, o.unsub),
    text: `Hi ${firstName(o.name)},\n\nNext up in ${o.space}: ${o.title}. Pick up where you left off, it takes a few minutes.\n\nContinue learning: ${o.url}\n\nUnsubscribe: ${o.unsub}`,
  }
}
