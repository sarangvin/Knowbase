// Coins, on screen: the balance in the top bar, and the moments coins
// arrive and leave.
//
// The coin is a rabbit's head cut from gold — the token itself is that
// shape, one ear standing and one folded at the tip — and nothing more: a
// thin rim, a polished gradient, one soft highlight along the top edge. No
// face, no ornament; the outline is the whole idea, kept plain so it sits
// quietly beside the streak and reads as an object, not a cartoon.
//
// Earning mints one: it appears where the coins were earned (the middle of
// the screen, or the quiz answer that earned them), spins up on a burst of
// light — a real spin, with an edge you can see as it turns — slows to face
// you, catches a glint, and then flies into the top bar, where the badge
// coin turns once to receive it and the count rolls up.
//
// Spending runs it the other way: a coin leaves the badge, spins down to
// the button that spent it, and breaks into gold dust.
//
// Waits for the streak card: when one action earns both, the card is the
// loud moment and the coin comes after it, into a top bar you can see.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useVault } from '../../vault/vaultStore'
import { useStreak } from '../streak/streakStore'
import { useCoins, type Award } from './coinStore'
import './coins.css'

// The token's outline: a rabbit's head, cut from gold. One ear stands, the
// other folds over at the tip. In a 64-unit box; everything else (rim, the
// 3D edge, the shine's mask) is drawn from this one path so they agree.
export const RABBIT =
  'M32 58C21.5 58 13.5 52.5 13.5 44.5C13.5 38.5 16.8 34.2 21.2 32.2' +
  'C19 25.5 17.6 16 18.6 9.6C19.2 5.8 22.6 4.4 24.8 7C27.8 10.6 29.2 20 28.8 30.4' +
  'C30.2 30.2 31.4 30.1 32.6 30.2C33.6 22 36 14.4 40.4 10.2C43 7.8 47.6 7.6 51.6 10.4' +
  'C54.4 12.4 55 15.6 53.6 17.2C52.4 18.4 50.2 17.4 48.6 16.6C46.4 17.8 44.4 23 43 31.8' +
  'C47.6 33.8 50.5 38.4 50.5 44.5C50.5 52.5 42.5 58 32 58Z'
/** Square box around the outline, with room for the rim's outer half. */
export const RABBIT_VIEWBOX = '4 1 60 60'

export function CoinIcon({ size = 18, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  const u = (n: string) => `url(#${id}-${n})`
  return (
    <svg className={className} width={size} height={size} viewBox={RABBIT_VIEWBOX} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-face`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="hsl(45 90% 72%)" />
          <stop offset="0.45" stopColor="hsl(39 82% 56%)" />
          <stop offset="1" stopColor="hsl(30 74% 40%)" />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="hsl(44 80% 62%)" />
          <stop offset="1" stopColor="hsl(26 70% 30%)" />
        </linearGradient>
        <path id={`${id}-shape`} d={RABBIT} />
        <clipPath id={`${id}-clip`}>
          <use href={`#${id}-shape`} />
        </clipPath>
      </defs>
      {/* plain polished gold: a rim, the face, one soft bevel highlight */}
      <use href={`#${id}-shape`} fill={u('face')} stroke={u('rim')} strokeWidth="3" strokeLinejoin="round" />
      <use
        href={`#${id}-shape`}
        fill="none"
        stroke="hsl(48 100% 90%)"
        strokeOpacity="0.45"
        strokeWidth="1.4"
        transform="translate(-0.8 -0.9)"
        clipPath={u('clip')}
      />
    </svg>
  )
}

/** The token's silhouette in one flat colour: a layer of the coin's edge. */
function CoinEdge({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox={RABBIT_VIEWBOX} aria-hidden="true">
      <path d={RABBIT} fill="currentColor" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  )
}

/** The silhouette as a CSS mask, so the shine stays inside the shape. */
const RABBIT_MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${RABBIT_VIEWBOX}'><path d='${RABBIT}' fill='#000' stroke='#000' stroke-width='3' stroke-linejoin='round'/></svg>`,
)}") center / contain no-repeat`

export function CoinBadge() {
  const user = useVault((s) => s.user)
  const coins = useCoins((s) => s.coins)
  const shown = useCoins((s) => s.shown)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  if (!user || !coins) return null
  return (
    <div className="coin-wrap" ref={ref}>
      <button
        className="coin-badge"
        onClick={() => setOpen((o) => !o)}
        title={`${coins.balance} coins`}
        aria-expanded={open}
      >
        <span className="coin-badge-icon">
          <CoinIcon size={19} />
        </span>
        <span className="coin-count">{shown}</span>
      </button>
      {open && (
        <div className="coin-pop" role="dialog" aria-label="Coins">
          <div className="coin-pop-head">
            <CoinIcon size={40} />
            <div>
              <div className="coin-pop-total">{coins.balance}</div>
              <div className="coin-pop-sub">coins</div>
            </div>
          </div>
          <ul className="coin-pop-rows">
            <li>
              <span>New notes finished</span>
              <span className="coin-pop-n">{coins.notes} × 3</span>
            </li>
            <li>
              <span>Quiz answers right</span>
              <span className="coin-pop-n">{coins.correctAnswers} × 2</span>
            </li>
            {coins.paidCollections > 0 && (
              <li>
                <span>Collections started</span>
                <span className="coin-pop-n spent">−{coins.paidCollections} × 10</span>
              </li>
            )}
          </ul>
          <p className="coin-pop-foot">
            {coins.nextCollectionCost === 0
              ? 'Your first collection is free. After that, each new one costs 10.'
              : coins.balance >= coins.nextCollectionCost
                ? `A new collection costs ${coins.nextCollectionCost}. You can afford one.`
                : `A new collection costs ${coins.nextCollectionCost}. ${coins.nextCollectionCost - coins.balance} more to go.`}
          </p>
        </div>
      )}
    </div>
  )
}

/** The price on a button that spends coins. */
export function CoinCost({ n }: { n: number }) {
  return (
    <span className="coin-cost" aria-label={`costs ${n} coins`}>
      <CoinIcon size={15} />
      {n}
    </span>
  )
}

/** Plays each award, once, after any streak card has been dismissed. */
export function CoinBurst() {
  const award = useCoins((s) => s.award)
  const celebration = useStreak((s) => s.celebration)
  if (!award || celebration) return null
  return createPortal(<Mint key={award.id} award={award} />, document.body)
}

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const EDGE_LAYERS = 6

function Mint({ award }: { award: Award }) {
  const spend = award.amount < 0
  const total = Math.abs(award.amount)
  // Smaller when it comes from something on the page (a quiz answer) than
  // when it takes the middle of the screen.
  const size = award.at ? 54 : 76
  const layer = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const { step, settle } = useCoins.getState()
    const root = layer.current
    const badgeIcon = document.querySelector<HTMLElement>('.coin-badge-icon')
    const timers: number[] = []
    const anims: Animation[] = []
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms))
    const cleanup = () => {
      anims.forEach((a) => a.cancel())
      timers.forEach(clearTimeout)
    }
    /** Roll the count, one coin at a time, over `ms`. */
    const roll = (from: number, ms: number) => {
      for (let i = 0; i < total; i++) later(from + (ms * i) / Math.max(1, total - 1), step)
    }

    if (!root || reduced()) {
      roll(0, 300)
      later(400, settle)
      return cleanup
    }

    const W = window.innerWidth
    const H = window.innerHeight
    const o = award.at ?? { x: W / 2, y: H * 0.45 }
    const b = badgeIcon?.getBoundingClientRect()
    const bx = b ? b.left + b.width / 2 : W - 60
    const by = b ? b.top + b.height / 2 : 20
    const tiny = (b?.width ?? 19) / size
    const q = (sel: string) => root.querySelector<HTMLElement>(sel)!
    const fly = q('.cm-fly')
    const spin = q('.cm-coin')
    const at = (x: number, y: number, s: number) => `translate(${x}px, ${y}px) scale(${s})`
    const label = q('.cm-label')

    const badgeTurn = () => {
      if (badgeIcon)
        anims.push(
          badgeIcon.animate([{ transform: 'rotateY(0)' }, { transform: 'rotateY(360deg)' }], {
            duration: 520,
            easing: 'cubic-bezier(.2,.7,.3,1)',
          }),
        )
    }
    const ring = () =>
      anims.push(
        q('.cm-ring').animate(
          [
            { transform: `translate(${bx}px, ${by}px) scale(0.4)`, opacity: 0.9 },
            { transform: `translate(${bx}px, ${by}px) scale(1.6)`, opacity: 0 },
          ],
          { duration: 520, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' },
        ),
      )

    if (!spend) {
      const T = 2000
      // The light it appears in: a soft halo and slow rays, at the origin.
      const glow = q('.cm-glow')
      glow.style.left = `${o.x}px`
      glow.style.top = `${o.y}px`
      label.style.left = `${o.x}px`
      label.style.top = `${o.y - size * 1.2}px`
      anims.push(
        glow.animate(
          [
            { opacity: 0, transform: 'translate(-50%,-50%) scale(0.5)' },
            { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.15 },
            { opacity: 0.85, transform: 'translate(-50%,-50%) scale(1.08)', offset: 0.55 },
            { opacity: 0, transform: 'translate(-50%,-50%) scale(1.2)', offset: 0.75 },
            { opacity: 0, transform: 'translate(-50%,-50%) scale(1.2)' },
          ],
          { duration: T, easing: 'ease-out', fill: 'both' },
        ),
        q('.cm-rays').animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(50deg)' }], { duration: T, fill: 'both' }),
        // Pops up, holds while it spins, then arcs into the badge.
        fly.animate(
          [
            { transform: at(o.x, o.y, 0.2), opacity: 0, easing: 'cubic-bezier(.3,1.5,.5,1)' },
            { transform: at(o.x, o.y - 6, 1), opacity: 1, offset: 0.13 },
            { transform: at(o.x, o.y - 6, 1), opacity: 1, offset: 0.66, easing: 'cubic-bezier(.45,0,.75,.5)' },
            { transform: at((o.x + bx) / 2 + 30, Math.min(o.y, by) + Math.abs(o.y - by) * 0.25, 0.6), opacity: 1, offset: 0.84 },
            { transform: at(bx, by, tiny), opacity: 1 },
          ],
          { duration: T, fill: 'both' },
        ),
        // Fast, slowing to face you; then one more turn in flight.
        spin.animate(
          [
            { transform: 'rotateY(0deg)', easing: 'cubic-bezier(.1,.7,.25,1)' },
            { transform: 'rotateY(1440deg)', offset: 0.56 },
            { transform: 'rotateY(1440deg)', offset: 0.68, easing: 'ease-in' },
            { transform: 'rotateY(1800deg)' },
          ],
          { duration: T, fill: 'both' },
        ),
        q('.cm-sheen').animate(
          [{ transform: 'translateX(-130%) skewX(-18deg)' }, { transform: 'translateX(130%) skewX(-18deg)' }],
          { duration: 420, delay: 1060, easing: 'ease-in-out', fill: 'both' },
        ),
        label.animate(
          [
            { transform: 'translate(-50%, 8px) scale(0.7)', opacity: 0 },
            { transform: 'translate(-50%, -6px) scale(1.06)', opacity: 1, offset: 0.25 },
            { transform: 'translate(-50%, -14px) scale(1)', opacity: 1, offset: 0.75 },
            { transform: 'translate(-50%, -26px) scale(1)', opacity: 0 },
          ],
          { duration: 1500, delay: 260, easing: 'ease-out', fill: 'both' },
        ),
      )
      later(T, () => {
        fly.style.visibility = 'hidden'
        badgeTurn()
        ring()
        sparkle(root, bx, by)
      })
      roll(T, 380)
      later(T + 650, settle)
    } else {
      const T = 1300
      label.style.left = `${o.x}px`
      label.style.top = `${o.y - size * 0.75}px`
      anims.push(
        fly.animate(
          [
            { transform: at(bx, by, tiny), opacity: 0 },
            { transform: at(bx, by + 8, tiny * 1.6), opacity: 1, offset: 0.08, easing: 'cubic-bezier(.3,0,.4,1)' },
            { transform: at(o.x, o.y, 0.85), opacity: 1, offset: 0.5 },
            { transform: at(o.x, o.y, 0.9), opacity: 1, offset: 0.66 },
            { transform: at(o.x, o.y, 1.25), opacity: 0 },
          ],
          { duration: T, fill: 'both' },
        ),
        spin.animate(
          [{ transform: 'rotateY(0deg)', easing: 'cubic-bezier(.3,0,.3,1)' }, { transform: 'rotateY(1080deg)' }],
          { duration: T, fill: 'both' },
        ),
        label.animate(
          [
            { transform: 'translate(-50%, 6px)', opacity: 0 },
            { transform: 'translate(-50%, -4px)', opacity: 1, offset: 0.3 },
            { transform: 'translate(-50%, -18px)', opacity: 0 },
          ],
          { duration: 1100, delay: 760, easing: 'ease-out', fill: 'both' },
        ),
      )
      badgeTurn()
      roll(80, 420)
      later(T * 0.7, () => sparkle(root, o.x, o.y, 14))
      later(T + 700, settle)
    }

    return cleanup
  }, [award, size, spend, total])

  return (
    <div className={`coin-mint${spend ? ' spend' : ''}`} ref={layer} aria-live="polite">
      <span className="cm-sr">{spend ? `${total} coins spent` : `+${total} coins`}</span>
      {!spend && (
        <div className="cm-glow" style={{ width: size * 3.2, height: size * 3.2 }}>
          <div className="cm-rays" />
        </div>
      )}
      <div className="cm-fly" style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}>
        <div className="cm-coin">
          <div className="cm-side cm-front">
            <CoinIcon size={size} />
            <div className="cm-sheen-clip" style={{ mask: RABBIT_MASK, WebkitMask: RABBIT_MASK }}>
              <div className="cm-sheen" />
            </div>
          </div>
          {Array.from({ length: EDGE_LAYERS }, (_, i) => (
            <div key={i} className="cm-edge" style={{ transform: `translateZ(${(i - (EDGE_LAYERS - 1) / 2) * 1.1}px)` }}>
              <CoinEdge size={size} />
            </div>
          ))}
          <div className="cm-side cm-back">
            <CoinIcon size={size} />
          </div>
        </div>
      </div>
      <div className="cm-label">{spend ? `−${total}` : `+${total}`}</div>
      <div className="cm-ring" />
    </div>
  )
}

/** Gold dust: a ring of flecks thrown out from a point. */
function sparkle(root: HTMLElement, x: number, y: number, count = 9) {
  for (let i = 0; i < count; i++) {
    const s = document.createElement('i')
    s.className = 'cm-fleck'
    root.appendChild(s)
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.5
    const r = 18 + Math.random() * 22
    s.animate(
      [
        { transform: `translate(${x}px, ${y}px) scale(1)`, opacity: 1 },
        { transform: `translate(${x + Math.cos(a) * r}px, ${y + Math.sin(a) * r}px) scale(0.2)`, opacity: 0 },
      ],
      { duration: 520 + Math.random() * 200, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' },
    )
  }
}
