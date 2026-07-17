import type { Request, Response, NextFunction } from 'express'

/** Gate a route on the caller's cached plan tier (users.plan_tier, kept in
 * sync with subscriptions by the billing webhook — see routes/billing.ts). */
export function requirePlan(tier: 'pro') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || req.user.planTier !== tier) {
      res.status(403).json({ error: `This requires a ${tier} plan.` })
      return
    }
    next()
  }
}
