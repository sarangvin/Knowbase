// Coins, on screen: the balance in the top bar, and the moments coins
// arrive and leave.
//
// The coin is a struck medallion, not a cartoon token: a milled rim, a
// bevelled field lit from the top left, and a rabbit's head in raised
// relief — one ear upright, one folded over at the tip — catching that
// light along its upper edges and throwing a shadow below. Painterly rather
// than flat: every surface is a gradient, and the shapes are a little
// angular, so it reads as cut metal at 18px and as an object at 72.
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

// The head and both ears, in a 64-unit box. Drawn once and reused for the
// relief's shadow, highlight and face.
const HEAD =
  'M21.2 39.4C21.2 33.2 25.6 29.6 30 29.1L28.3 25.6C26.1 21 24.6 15.6 25.1 11.6C25.4 9.6 27.6 9 28.9 10.4' +
  'C31.2 13.2 32 19.6 31.9 28.9L32.6 28.9C33.2 23.2 34.4 17.4 37.3 13.7C38.9 11.7 41.7 11.4 43.4 12.8' +
  'C44.6 13.8 44.3 15.4 42.9 15.9C40.9 16.6 39.3 18.6 38.4 21.6L36.9 29.6C40.9 30.6 43.2 34.4 42.9 39.4' +
  'C42.5 45 37.9 48.6 32 48.6C26 48.6 21.2 45.2 21.2 39.4Z'
const EARS_INNER =
  'M27.2 13.6C28.6 15.8 29.6 20.6 29.8 26.6L28.9 26.4C27.6 22.4 26.7 17.8 27.2 13.6Z' +
  'M41.4 14.2C39.3 15 37.6 17 36.6 20.4L35.2 27.2L34.5 27.1C35 22.6 36.3 18 38.4 15.2C39.4 14 40.6 13.8 41.4 14.2Z'

export function CoinIcon({ size = 18, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  const u = (n: string) => `url(#${id}-${n})`
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-rim`} cx="0.32" cy="0.28" r="0.85">
          <stop offset="0" stopColor="hsl(46 100% 80%)" />
          <stop offset="0.45" stopColor="hsl(38 92% 56%)" />
          <stop offset="0.8" stopColor="hsl(27 86% 38%)" />
          <stop offset="1" stopColor="hsl(20 80% 24%)" />
        </radialGradient>
        <radialGradient id={`${id}-field`} cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor="hsl(42 96% 62%)" />
          <stop offset="0.55" stopColor="hsl(32 88% 45%)" />
          <stop offset="1" stopColor="hsl(23 84% 29%)" />
        </radialGradient>
        <linearGradient id={`${id}-relief`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="hsl(48 100% 86%)" />
          <stop offset="0.5" stopColor="hsl(40 96% 64%)" />
          <stop offset="1" stopColor="hsl(30 88% 46%)" />
        </linearGradient>
        <path id={`${id}-head`} d={HEAD} />
      </defs>

      {/* rim, milled edge, bevel */}
      <circle cx="32" cy="32" r="31" fill={u('rim')} />
      <circle cx="32" cy="32" r="29.2" fill="none" stroke="hsl(24 80% 22%)" strokeOpacity="0.55" strokeWidth="1.6" strokeDasharray="1.1 1.5" />
      <circle cx="32" cy="32" r="25.6" fill="hsl(22 80% 24%)" opacity="0.55" />
      <circle cx="32" cy="32" r="25" fill={u('field')} />
      <path d="M11.5 27A21 21 0 0 1 27 11.2" fill="none" stroke="hsl(48 100% 90%)" strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M52.5 37A21 21 0 0 1 37 52.8" fill="none" stroke="hsl(20 80% 22%)" strokeOpacity="0.45" strokeWidth="1.2" strokeLinecap="round" />

      {/* the relief: shadow below-right, light above-left, then the face —
          a touch larger than drawn, so it holds up at badge size */}
      <g transform="translate(32 31) scale(1.1) translate(-32 -31)">
        <use href={`#${id}-head`} fill="hsl(20 80% 16%)" opacity="0.6" transform="translate(1.3 1.6)" />
        <use href={`#${id}-head`} fill="hsl(50 100% 92%)" opacity="0.9" transform="translate(-0.8 -0.9)" />
        <use href={`#${id}-head`} fill={u('relief')} stroke="hsl(24 80% 26%)" strokeOpacity="0.5" strokeWidth="0.7" />
        <path d={EARS_INNER} fill="hsl(26 86% 40%)" opacity="0.75" />
        {/* eyes, angular; a nose; a mouth */}
        <path d="M26.4 37.2L29.6 36.2L29 38.8Z" fill="hsl(20 80% 18%)" />
        <path d="M37.6 37.2L34.4 36.2L35 38.8Z" fill="hsl(20 80% 18%)" />
        <path d="M30.6 42.2H33.4L32 43.9Z" fill="hsl(20 80% 22%)" />
        <path d="M32 43.9V45.2M32 45.2C31 46 29.8 46 29 45.4M32 45.2C33 46 34.2 46 35 45.4" fill="none" stroke="hsl(20 80% 24%)" strokeWidth="0.8" strokeLinecap="round" />
      </g>

      {/* a four-point glint */}
      <path d="M50 10.5L51 13.6L54.1 14.6L51 15.6L50 18.7L49 15.6L45.9 14.6L49 13.6Z" fill="hsl(50 100% 96%)" opacity="0.9" />
    </svg>
  )
}

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
      label.style.top = `${o.y - size * 0.95}px`
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
            <div className="cm-sheen-clip">
              <div className="cm-sheen" />
            </div>
          </div>
          {Array.from({ length: EDGE_LAYERS }, (_, i) => (
            <div key={i} className="cm-edge" style={{ transform: `translateZ(${(i - (EDGE_LAYERS - 1) / 2) * 1.1}px)` }} />
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
