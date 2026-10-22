// The streak, on screen: a bare count in the top bar, and the card that
// plays when the day's goal is met.
//
// The card is the one loud moment. The number ticks over from yesterday's
// count to today's, the day lights up in the week row, and that is all —
// no mascot, no sound, one button. The top bar count is the quiet one: a
// flame and a number, dim until today is done.
import { useEffect, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { useStreak, type Celebration } from './streakStore'
import { Flame, Snowflake, Check } from '../../ui/icons'
import './streak.css'

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function weekdayOf(day: string): string {
  return WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()]
}

export function StreakBadge() {
  const user = useVault((s) => s.user)
  const streak = useStreak((s) => s.streak)
  if (!user || !streak) return null
  const open = () =>
    useStreak.setState({ celebration: { from: streak.days, to: streak.days, streak } })
  return (
    <button
      className={`streak-badge${streak.todayDone ? ' done' : ''}`}
      onClick={open}
      title={
        streak.todayDone
          ? `${streak.days}-day streak — today is done`
          : `${streak.days}-day streak — read a new note, finish your flashcards or the quiz to keep it`
      }
    >
      <Flame width={16} height={16} />
      <span>{streak.days}</span>
    </button>
  )
}

export function StreakCelebration() {
  const celebration = useStreak((s) => s.celebration)
  const dismiss = useStreak((s) => s.dismiss)
  if (!celebration) return null
  // Keyed, so a second celebration replays from the start.
  return <Card key={`${celebration.from}-${celebration.to}`} c={celebration} onClose={dismiss} />
}

function Card({ c, onClose }: { c: Celebration; onClose: () => void }) {
  const { from, to, streak } = c
  const extending = to > from
  // Shows `from` first, then rolls to `to`: the tick-over is the moment.
  const [shown, setShown] = useState(extending ? from : to)
  useEffect(() => {
    if (!extending) return
    const t = setTimeout(() => setShown(to), 550)
    return () => clearTimeout(t)
  }, [extending, to])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const today = streak.week[streak.week.length - 1]?.day
  const rolled = shown === to

  let line: string
  if (!extending) {
    line = streak.todayDone
      ? 'Today is done.'
      : 'Read a new note, finish your flashcards, or finish the quiz to keep it going today.'
  } else if (to === 1) {
    line = 'Day one. Come back tomorrow to keep it going.'
  } else {
    line = 'One more day kept.'
  }

  return (
    <div className="streak-backdrop" onClick={onClose}>
      <div
        className={`streak-card${extending ? ' extending' : ''}`}
        role="dialog"
        aria-label={`${to}-day streak`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`streak-flame${rolled && extending ? ' lit' : ''}`}>
          <Flame width={56} height={56} />
        </div>

        <div className="streak-count" aria-live="polite">
          <span key={shown} className={extending ? 'streak-digit roll' : 'streak-digit'}>
            {shown}
          </span>
        </div>
        <div className="streak-label">day streak</div>

        <div className="streak-week">
          {streak.week.map((d) => {
            const isToday = d.day === today
            return (
              <div key={d.day} className="streak-day">
                <span className="streak-day-letter">{weekdayOf(d.day)}</span>
                <span
                  className={`streak-dot ${d.state}${isToday ? ' today' : ''}${
                    isToday && extending && rolled ? ' pop' : ''
                  }`}
                >
                  {d.state === 'done' && (!isToday || !extending || rolled) ? (
                    <Check width={13} height={13} />
                  ) : d.state === 'frozen' ? (
                    <Snowflake width={12} height={12} />
                  ) : null}
                </span>
              </div>
            )
          })}
        </div>

        <p className="streak-line">{line}</p>

        <div className="streak-freezes" title="A missed day uses a freeze instead of ending the streak. Every 7 days kept earns one, and your first lesson earns a bonus one.">
          {Array.from({ length: streak.maxFreezes }, (_, i) => (
            <Snowflake key={i} width={14} height={14} className={i < streak.freezes ? 'held' : 'spent'} />
          ))}
          <span>
            {streak.freezes} of {streak.maxFreezes} freezes
          </span>
        </div>

        {streak.justGraduated && (
          <p className="streak-graduated">
            {streak.graduationStreak} days in — your daily limits just went up.
          </p>
        )}

        <button className="ob-btn primary streak-continue" onClick={onClose} autoFocus>
          Continue
        </button>
      </div>
    </div>
  )
}

function dayName(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' })
}

/**
 * Told once, the next time the app opens after a freeze was spent: which day
 * it covered, that the streak is still going, and how many are left. A
 * freeze working silently is a safety net nobody knows is there — and the
 * reader who has just used their last one is the one who most needs to know.
 */
export function FreezeNotice() {
  const notice = useStreak((s) => s.freezeNotice)
  const dismiss = useStreak((s) => s.dismissFreeze)
  const celebration = useStreak((s) => s.celebration)

  useEffect(() => {
    if (!notice) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [notice, dismiss])

  // One card at a time: the celebration first if both are due.
  if (!notice || celebration) return null
  const { days, remaining, max, streakDays } = notice
  const missed =
    days.length === 1 ? dayName(days[0]) : `${days.slice(0, -1).map(dayName).join(', ')} and ${dayName(days[days.length - 1])}`
  const used = days.length === 1 ? 'A streak freeze' : `${days.length} streak freezes`

  return (
    <div className="streak-backdrop" onClick={dismiss}>
      <div className="streak-card freeze-card" role="dialog" aria-label="Streak freeze used" onClick={(e) => e.stopPropagation()}>
        <div className="streak-flame freeze-icon">
          <Snowflake width={52} height={52} />
        </div>
        <div className="freeze-title">{used} used</div>
        <p className="streak-line">
          You missed {missed}, so {days.length === 1 ? 'a freeze' : 'your freezes'} kept your
          {streakDays > 0 ? ` ${streakDays}-day` : ''} streak going.
        </p>

        <div className="streak-freezes freeze-left">
          {Array.from({ length: max }, (_, i) => (
            <Snowflake key={i} width={18} height={18} className={i < remaining ? 'held' : 'spent'} />
          ))}
          <span>
            {remaining} of {max} freezes left
          </span>
        </div>

        <p className="freeze-hint">
          {remaining === 0
            ? 'None left — miss another day and the streak starts over. Keep it for 7 days to earn one back.'
            : remaining < max
              ? 'Keep your streak for 7 days to earn one back.'
              : 'You’re back to a full set.'}
        </p>

        <button className="ob-btn primary streak-continue" onClick={dismiss} autoFocus>
          Got it
        </button>
      </div>
    </div>
  )
}
