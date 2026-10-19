// Coins, on screen: the balance in the top bar, and the moments they arrive
// and leave.
//
// The coin is a burrow token — warm carrot-gold, with a pair of rabbit ears
// rising out of a hole stamped on its face. When coins are earned they come
// *up out of the rabbit hole*: a burrow opens mid-screen, the coins pop out
// one by one, flipping as they go, and fly into the top bar, where the count
// ticks up once per coin as each one lands. Before the burrow closes, a pair
// of ears peeks out after them and ducks back down. That last beat is the
// signature: small, a little silly, and only ever seen here.
//
// Spending runs the same scene backwards: starting a new collection sends
// coins out of the badge and down into the burrow, the count ticking down
// as each one leaves, and the ears come up to catch them.
//
// Waits for the streak card: when one action earns both, the card is the
// loud moment and the coins come after it, into a top bar you can see.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useVault } from '../../vault/vaultStore'
import { useStreak } from '../streak/streakStore'
import { useCoins, type Award } from './coinStore'
import './coins.css'

export function CoinIcon({ size = 18, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="hsl(44 96% 70%)" />
          <stop offset="0.55" stopColor="hsl(32 92% 56%)" />
          <stop offset="1" stopColor="hsl(22 80% 40%)" />
        </linearGradient>
        <linearGradient id={`${id}-face`} x1="1" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="hsl(40 95% 64%)" />
          <stop offset="1" stopColor="hsl(28 88% 50%)" />
        </linearGradient>
      </defs>
      {/* rim, then a recessed face, so it reads as a struck coin */}
      <circle cx="12" cy="12" r="11" fill={`url(#${id}-rim)`} />
      <circle cx="12" cy="12" r="11" fill="none" stroke="hsl(20 70% 26%)" strokeOpacity="0.55" strokeWidth="0.8" />
      <circle cx="12" cy="12" r="8.3" fill={`url(#${id}-face)`} />
      <circle cx="12" cy="12" r="8.3" fill="none" stroke="hsl(22 75% 34%)" strokeOpacity="0.5" strokeWidth="0.7" />
      {/* the stamp: two ears rising out of a burrow */}
      <g fill="hsl(22 72% 34%)">
        <ellipse cx="10.1" cy="10.2" rx="1.35" ry="3.6" transform="rotate(-14 10.1 10.2)" />
        <ellipse cx="13.9" cy="10.2" rx="1.35" ry="3.6" transform="rotate(14 13.9 10.2)" />
        <ellipse cx="12" cy="15.3" rx="4.3" ry="1.45" />
      </g>
      <g fill="hsl(46 100% 82%)" opacity="0.7">
        <ellipse cx="9.8" cy="9.4" rx="0.45" ry="2.1" transform="rotate(-14 9.8 9.4)" />
        <ellipse cx="13.6" cy="9.4" rx="0.45" ry="2.1" transform="rotate(14 13.6 9.4)" />
      </g>
      {/* shine */}
      <path d="M5.2 9.2A7.6 7.6 0 0 1 10 4.6" fill="none" stroke="hsl(50 100% 92%)" strokeOpacity="0.75" strokeWidth="1.3" strokeLinecap="round" />
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
        <CoinIcon className="coin-badge-icon" size={17} />
        <span className="coin-count">{shown}</span>
      </button>
      {open && (
        <div className="coin-pop" role="dialog" aria-label="Coins">
          <div className="coin-pop-head">
            <CoinIcon size={30} />
            <div>
              <div className="coin-pop-total">{coins.balance}</div>
              <div className="coin-pop-sub">coins in the burrow</div>
            </div>
          </div>
          <ul className="coin-pop-rows">
            <li>
              <span>New notes finished</span>
              <span className="coin-pop-n">{coins.notes} × 3</span>
            </li>
            <li>
              <span>Quizzes completed</span>
              <span className="coin-pop-n">{coins.quizzes} × 7</span>
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
      <CoinIcon size={14} />
      {n}
    </span>
  )
}

/** Plays each award, once, after any streak card has been dismissed. */
export function CoinBurst() {
  const award = useCoins((s) => s.award)
  const celebration = useStreak((s) => s.celebration)
  if (!award || celebration) return null
  return createPortal(<Burst key={award.id} award={award} />, document.body)
}

const MAX_FLYING = 10
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function Burst({ award }: { award: Award }) {
  const spend = award.amount < 0
  const total = Math.abs(award.amount)
  const n = Math.min(total, MAX_FLYING)
  const layer = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const { landed, settle } = useCoins.getState()
    const root = layer.current
    const badge = document.querySelector<HTMLElement>('.coin-badge-icon')
    const pulse = () =>
      document.querySelector<HTMLElement>('.coin-badge')?.animate(
        spend
          ? [{ transform: 'scale(1)' }, { transform: 'scale(0.86)' }, { transform: 'scale(1)' }]
          : [{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }],
        { duration: spend ? 180 : 260, easing: 'cubic-bezier(.3,1.6,.5,1)' },
      )

    if (!root || reduced()) {
      for (let i = 0; i < total; i++) landed()
      pulse()
      const t = setTimeout(settle, 300)
      return () => clearTimeout(t)
    }

    const W = window.innerWidth
    const H = window.innerHeight
    const hx = W / 2
    const hy = Math.min(H * 0.6, H - 140)
    const b = badge?.getBoundingClientRect()
    const bx = b ? b.left + b.width / 2 : W - 60
    const by = b ? b.top + b.height / 2 : 20
    const anims: Animation[] = []
    const timers: number[] = []
    const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms))
    const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!
    const STAGGER = spend ? 70 : 90
    const FLIGHT = spend ? 900 : 1050

    // The burrow opens.
    const hole = q('.cb-hole')
    hole.style.left = `${hx}px`
    hole.style.top = `${hy}px`
    anims.push(
      hole.animate(
        [
          { transform: 'translate(-50%,-50%) scale(0, 0.2)', opacity: 0 },
          { transform: 'translate(-50%,-50%) scale(1.08, 1.05)', opacity: 1, offset: 0.12 },
          { transform: 'translate(-50%,-50%) scale(1, 1)', opacity: 1, offset: 0.2 },
          { transform: 'translate(-50%,-50%) scale(1, 1)', opacity: 1, offset: 0.86 },
          { transform: 'translate(-50%,-50%) scale(0, 0.2)', opacity: 0 },
        ],
        { duration: 1500 + n * STAGGER, easing: 'ease-out', fill: 'forwards' },
      ),
    )

    // "+N" rises out of it; "−N" sinks into it.
    const label = q('.cb-plus')
    label.style.left = `${hx}px`
    label.style.top = `${hy}px`
    anims.push(
      label.animate(
        spend
          ? [
              { transform: 'translate(-50%, -110px) scale(1.1)', opacity: 0 },
              { transform: 'translate(-50%, -84px) scale(1)', opacity: 1, offset: 0.2 },
              { transform: 'translate(-50%, -70px) scale(1)', opacity: 1, offset: 0.7 },
              { transform: 'translate(-50%, -10px) scale(0.5)', opacity: 0 },
            ]
          : [
              { transform: 'translate(-50%, 0) scale(0.6)', opacity: 0 },
              { transform: 'translate(-50%, -64px) scale(1.15)', opacity: 1, offset: 0.25 },
              { transform: 'translate(-50%, -78px) scale(1)', opacity: 1, offset: 0.7 },
              { transform: 'translate(-50%, -96px) scale(0.95)', opacity: 0 },
            ],
        { duration: 1500, delay: 200, easing: 'ease-out', fill: 'both' },
      ),
    )

    // Earned: out of the hole in a fan, up, then into the badge.
    // Spent: out of the badge, up in a hop, then down into the hole.
    const coinEls = root.querySelectorAll<HTMLElement>('.cb-coin')
    const share = total / n
    coinEls.forEach((el, i) => {
      const spread = (i - (n - 1) / 2) * Math.min(34, 220 / n) + (Math.random() - 0.5) * 14
      const peak = hy - 120 - Math.random() * 60
      const delay = 180 + i * STAGGER
      const frames: Keyframe[] = spend
        ? [
            { transform: `translate(${bx}px, ${by}px) scale(0.45)`, opacity: 0, easing: 'cubic-bezier(.2,.8,.3,1)' },
            { transform: `translate(${bx - 20 + spread * 0.2}px, ${by + 26}px) scale(0.85)`, opacity: 1, offset: 0.18 },
            {
              transform: `translate(${hx + spread * 0.5}px, ${hy - 90}px) scale(1)`,
              opacity: 1,
              offset: 0.7,
              easing: 'cubic-bezier(.6,0,.9,.5)',
            },
            { transform: `translate(${hx}px, ${hy}px) scale(0.25)`, opacity: 0 },
          ]
        : [
            { transform: `translate(${hx}px, ${hy}px) scale(0.3)`, opacity: 0, easing: 'cubic-bezier(.2,.8,.3,1)' },
            { transform: `translate(${hx + spread * 0.6}px, ${hy - 40}px) scale(0.9)`, opacity: 1, offset: 0.12 },
            {
              transform: `translate(${hx + spread}px, ${peak}px) scale(1.1)`,
              opacity: 1,
              offset: 0.38,
              easing: 'cubic-bezier(.5,0,.85,.45)',
            },
            { transform: `translate(${bx}px, ${by}px) scale(0.45)`, opacity: 1 },
          ]
      const fly = el.animate(frames, { duration: FLIGHT, delay, fill: 'both' })
      // The flip: rotateY on the inner face reads as a spinning coin.
      const face = el.firstElementChild as HTMLElement
      anims.push(
        fly,
        face.animate([{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${720 + (i % 2) * 180}deg)` }], {
          duration: FLIGHT,
          delay,
          easing: 'cubic-bezier(.2,.6,.4,1)',
          fill: 'both',
        }),
      )
      // When an award is bigger than the coins drawn, each carries its share.
      const k = Math.round(share * (i + 1)) - Math.round(share * i)
      const tick = () => {
        for (let j = 0; j < k; j++) landed()
        pulse()
      }
      // A spent coin leaves the count as it leaves the badge; an earned one
      // joins it as it arrives.
      if (spend) later(delay + 60, tick)
      fly.onfinish = () => {
        el.style.visibility = 'hidden'
        if (!spend) {
          tick()
          if (i === n - 1) sparkle(root, bx, by)
        }
      }
    })

    // The ears peek out after the last coin — on a spend, to catch it.
    const ears = q('.cb-ears')
    ears.style.left = `${hx}px`
    ears.style.top = `${hy}px`
    anims.push(
      ears.animate(
        [
          { transform: 'translate(-50%, -20%) scaleY(0.2)', opacity: 0 },
          { transform: 'translate(-50%, -88%) scaleY(1.05)', opacity: 1, offset: 0.25 },
          { transform: 'translate(-50%, -82%) rotate(-4deg)', opacity: 1, offset: 0.45 },
          { transform: 'translate(-50%, -82%) rotate(4deg)', opacity: 1, offset: 0.62 },
          { transform: 'translate(-50%, -20%) scaleY(0.2)', opacity: 0 },
        ],
        { duration: 780, delay: 260 + n * STAGGER + (spend ? 560 : 280), easing: 'ease-in-out', fill: 'both' },
      ),
    )

    later(1300 + n * STAGGER + 600, settle)
    return () => {
      anims.forEach((a) => a.cancel())
      timers.forEach(clearTimeout)
    }
  }, [award, n, spend, total])

  return (
    <div className={`coin-burst${spend ? ' spend' : ''}`} ref={layer} aria-live="polite">
      <span className="cb-sr">{spend ? `${total} coins spent` : `+${total} coins`}</span>
      <div className="cb-hole" />
      <div className="cb-ears">
        <span />
        <span />
      </div>
      <div className="cb-plus">{spend ? `−${total}` : `+${total}`}</div>
      {Array.from({ length: n }, (_, i) => (
        <div className="cb-coin" key={i}>
          <div className="cb-face">
            <CoinIcon size={34} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** A ring of carrot-gold flecks where the last coin lands. */
function sparkle(root: HTMLElement, x: number, y: number) {
  const COUNT = 8
  for (let i = 0; i < COUNT; i++) {
    const s = document.createElement('i')
    s.className = 'cb-fleck'
    root.appendChild(s)
    const a = (i / COUNT) * Math.PI * 2 + Math.PI / COUNT
    const r = 20 + (i % 2) * 8
    s.animate(
      [
        { transform: `translate(${x}px, ${y}px) scale(1)`, opacity: 1 },
        { transform: `translate(${x + Math.cos(a) * r}px, ${y + Math.sin(a) * r}px) scale(0.2)`, opacity: 0 },
      ],
      { duration: 480, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' },
    )
  }
}
