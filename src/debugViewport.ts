// Temporary: an on-screen viewport readout, shown only with ?debug=viewport.
//
// Mobile layout bugs are hard to diagnose remotely — the desktop browser pane
// can't reproduce a phone's URL bar or its visual-vs-layout viewport split,
// and asking someone to type a javascript: URL on a phone is unreliable
// because Chrome strips the prefix on paste. This puts the numbers on the
// screen so a screenshot is enough.
//
// Deliberately plain DOM and mounted outside React: it must still render if
// the app itself fails to lay out. Remove once mobile layout is settled.
export function mountViewportDebug(): void {
  if (!new URLSearchParams(location.search).has('debug')) return

  const box = document.createElement('div')
  box.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'z-index:99999',
    'background:#000',
    'color:#0f0',
    'font:11px/1.45 ui-monospace,monospace',
    'padding:6px 8px',
    'border:1px solid #0f0',
    'white-space:pre',
    'pointer-events:none',
    'max-width:100%',
  ].join(';')
  document.body.appendChild(box)

  const render = () => {
    const de = document.documentElement
    const app = document.querySelector('.app')
    // If layoutW exceeds visualW, the page is laid out wider than what is
    // actually on screen — that is the crop, and it points at the viewport
    // meta or a min-content blowout rather than at any single component.
    box.textContent = [
      `visual  innerWidth   ${window.innerWidth}`,
      `layout  clientWidth  ${de.clientWidth}`,
      `doc     scrollWidth  ${de.scrollWidth}`,
      `body    scrollWidth  ${document.body.scrollWidth}`,
      `.app    width        ${app ? Math.round(app.getBoundingClientRect().width) : '-'}`,
      `screen  width        ${screen.width}`,
      `dpr                  ${window.devicePixelRatio}`,
      `visualViewport       ${window.visualViewport ? Math.round(window.visualViewport.width) + ' @' + window.visualViewport.scale.toFixed(2) : 'n/a'}`,
    ].join('\n')
  }

  render()
  addEventListener('resize', render)
  window.visualViewport?.addEventListener('resize', render)
  setInterval(render, 1000)
}
