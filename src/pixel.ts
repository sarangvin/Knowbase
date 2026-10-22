// Anonymous funnel checkpoints — see backend/src/usage/pixel.ts. A name and
// nothing else: no user, no topic, no page state.
//
// sendBeacon rather than fetch because the checkpoints that matter most fire
// right before a full-page redirect to Google, which cancels a pending fetch.
export type ClientPixel = 'landing_view' | 'landing_view_signed_in' | 'signup_click' | 'login_click' | 'note_swipe_left'

export function pixel(name: ClientPixel): void {
  try {
    navigator.sendBeacon(`/api/pixel/${name}`)
  } catch {
    // A counter must never break the thing it is counting.
  }
}
