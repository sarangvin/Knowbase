// Plan facts the client needs in more than one place.

/** Off until Razorpay checkout is wired up for real. While off, nobody is
 *  offered a way to pay; Pro and Max are granted by hand from the admin
 *  panel (the plan toggle on the Users tab), and an account that has one
 *  still sees it in Settings. Flip this when payments go live — the
 *  checkout code in SettingsPanel is kept for that. */
export const PAYMENTS_ENABLED = false

/** Pro and everything above it. Where a feature is "Pro", Max has it too.
 *  Mirrors atLeastPro in backend/src/plans.ts. */
export function atLeastPro(planTier?: string | null): boolean {
  return planTier === 'pro' || planTier === 'max'
}

export function planLabel(planTier?: string | null): string {
  return planTier === 'max' ? 'Max' : planTier === 'pro' ? 'Pro' : 'Free'
}
