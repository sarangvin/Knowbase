import type { Request, Response, NextFunction } from 'express'
import { atLeastPro } from '../plans.js'

/** Gate a route on the caller's cached plan tier (users.plan_tier, kept in
 * sync with subscriptions by the billing webhook — see routes/billing.ts).
 * 'pro' admits Max too: Max is Pro and more. */
export function requirePlan(tier: 'pro') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !atLeastPro(req.user.planTier)) {
      res.status(403).json({ error: `This requires a ${tier} plan.` })
      return
    }
    next()
  }
}
