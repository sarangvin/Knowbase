// Express 4 does not catch rejections from async route handlers — an
// uncaught throw inside one becomes an unhandled promise rejection, which
// terminates the whole Node process (Node 15+ default), not just the
// request. Every async handler in this backend must be wrapped in this so a
// bug or a missing env var in one request can't take the server down for
// every other user. Wrapped errors flow to the error middleware in app.ts.
import type { NextFunction, Request, RequestHandler, Response } from 'express'

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next)
  }
}
