// The one-time "want daily reminders?" prompt, shown the next time a signed-in
// reader opens the app after reminders became available.
//
// Asked once per account, not per device: the answer is recorded on the
// server (users.notify_prompted_at) whichever way it goes. It is only shown
// where it can actually work — a browser that supports push, a server that
// can send — so an iPhone outside the home screen is not asked a question it
// cannot act on; it will be asked once it can.
import { useEffect, useState } from 'react'
import { useVault } from '../../vault/vaultStore'
import { useStreak } from '../streak/streakStore'
import { pushSupported, getNotificationStatus, enableNotifications, markPrompted } from './notifications'
import './settings.css'

type Step = 'ask' | 'working' | 'on' | 'declined' | 'error'

export function NotificationPrompt() {
  const user = useVault((s) => s.user)
  // Never on top of the streak card or the freeze notice; wait for them.
  const celebrating = useStreak((s) => s.celebration != null || s.freezeNotice != null)
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [step, setStep] = useState<Step | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user || !pushSupported()) return
    let cancelled = false
    getNotificationStatus()
      .then((s) => {
        if (cancelled || s.enabled || s.prompted || !s.publicKey) return
        setPublicKey(s.publicKey)
        setStep('ask')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user])

  if (!step || celebrating) return null

  const close = () => setStep(null)

  const accept = async () => {
    setStep('working')
    // Recorded first: whatever happens with the browser's permission dialog,
    // the question has been put and answered.
    void markPrompted().catch(() => {})
    try {
      await enableNotifications(publicKey!)
      setStep('on')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('error')
    }
  }

  const decline = () => {
    void markPrompted().catch(() => {})
    setStep('declined')
  }

  return (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="notify-prompt-title">
      <div className="confirm-box notify-prompt-box">
        {step === 'ask' || step === 'working' ? (
          <>
            <div className="confirm-title" id="notify-prompt-title">Daily reminders are here 🐇</div>
            <p className="confirm-body">
              Want a nudge to keep learning?
              <br />
              We'll send you one reminder every day, and never more than that :)
            </p>
            <div className="confirm-actions">
              <button className="ask-btn" disabled={step === 'working'} onClick={decline}>
                No thanks
              </button>
              <button className="ask-btn primary" autoFocus disabled={step === 'working'} onClick={() => void accept()}>
                {step === 'working' ? 'Turning on…' : 'Turn on reminders'}
              </button>
            </div>
          </>
        ) : step === 'on' ? (
          <>
            <div className="confirm-title" id="notify-prompt-title">You're all set</div>
            <p className="confirm-body">
              Daily reminders are on. You can turn them off any time in Settings → Notifications.
            </p>
            <div className="confirm-actions">
              <button className="ask-btn primary" autoFocus onClick={close}>Got it</button>
            </div>
          </>
        ) : (
          <>
            <div className="confirm-title" id="notify-prompt-title">
              {step === 'declined' ? 'No problem' : "Couldn't turn them on"}
            </div>
            <p className="confirm-body">
              {step === 'error' && <>{error} </>}
              If you change your mind, daily reminders are always available in Settings →
              Notifications.
            </p>
            <div className="confirm-actions">
              <button className="ask-btn primary" autoFocus onClick={close}>OK</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
