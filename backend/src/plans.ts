// What each plan may do. One table, read by everything that enforces a limit.
//
// These numbers lived in three files — the flashcard builder, the questions
// route and the onboarding limits — each with its own `Record<string, …>`
// keyed by plan. That was survivable while there was one plan; adding a
// second meant editing three tables in step, which is the exact split this
// codebase keeps paying for. They are all here now, and each call site asks
// this file.
//
// `users.plan_tier` is the input. It is normally written by the Razorpay
// webhook, and the owner can set it by hand from the admin panel — see the
// note on `POST /api/admin/users/:id/plan`.

/** A limit that is not a limit. Only ever compared against, never counted
 *  up to, and never passed anywhere that would try to allocate it. */
export const UNLIMITED = Number.POSITIVE_INFINITY

export interface PlanLimits {
  /** Collections not archived. Archiving or deleting frees a slot. */
  activeCollections: number
  /** New collections started in one local day. */
  newCollectionsPerDay: number
  /** Cards in a day's deck. Never UNLIMITED: a deck is a sitting, and an
   *  infinite one is not a bigger sitting, it is a broken one. */
  flashcardsPerDay: number
  /** Questions of your own, per collection per local day. */
  customQuestionsPerDay: number
}

const PLANS: Record<string, PlanLimits> = {
  free: {
    activeCollections: 5,
    newCollectionsPerDay: 3,
    flashcardsPerDay: 10,
    customQuestionsPerDay: 1,
  },
  pro: {
    activeCollections: UNLIMITED,
    newCollectionsPerDay: UNLIMITED,
    // A number rather than UNLIMITED, for the reason above. Twice the free
    // deck is a longer sitting; it is not a different product.
    flashcardsPerDay: 20,
    customQuestionsPerDay: UNLIMITED,
  },
}

/** Unknown tiers get the free limits. A plan string nobody recognises is
 *  more likely a typo or a stale row than an entitlement. */
export function limitsFor(planTier?: string | null): PlanLimits {
  return PLANS[planTier ?? 'free'] ?? PLANS.free
}

export function isUnlimited(n: number): boolean {
  return !Number.isFinite(n)
}

/** For copy: "3 left today" reads badly when the answer is "as many as you
 *  like". Callers that show a count use this to decide whether to. */
export function remainingOf(limit: number, used: number): number | null {
  return isUnlimited(limit) ? null : Math.max(0, limit - used)
}

export const PLAN_TIERS = ['free', 'pro'] as const
export type PlanTier = (typeof PLAN_TIERS)[number]

export function isPlanTier(v: unknown): v is PlanTier {
  return typeof v === 'string' && (PLAN_TIERS as readonly string[]).includes(v)
}
