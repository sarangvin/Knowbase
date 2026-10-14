// The reminders, in the order they rotate through (users.notify_cursor).
// Each one nudges toward any of the three things that keep a streak: a
// lesson, the quiz, or the flashcards. One is enough, and they should say so.

export interface PushMessage {
  title: string
  body: string
}

export const REMINDERS: readonly PushMessage[] = [
  { title: 'The rabbit hole misses you', body: 'It has been 24 hours. One lesson and it stops sulking.' },
  { title: 'Your flashcards are bored', body: 'They have been face down all day. Flip a few?' },
  { title: 'Pop quiz (literally)', body: 'Five questions. No grades. Only glory.' },
  { title: 'Brain stretch time', body: 'One short lesson keeps the streak alive. Your neurons will thank you.' },
  { title: 'Knock knock', body: 'Who’s there? Today’s quiz. Today’s quiz who? Today’s quiz you haven’t done yet.' },
  { title: 'A rabbit is tapping its foot', body: 'Impatiently. Since yesterday. A quick lesson would calm it down.' },
  { title: 'Fun fact', body: 'You are one lesson away from knowing one more fun fact.' },
  { title: 'Your streak called', body: 'It wants to know if you two are still a thing. Answer with a quiz.' },
  { title: 'Flashcards, assemble', body: 'They are lined up and ready. All you have to do is tap.' },
  { title: 'Curiosity check-in', body: 'Still curious? Prove it with one lesson.' },
  { title: 'Plot twist', body: 'The next note in your collection is actually interesting. Go see.' },
  { title: 'Minimum effort, maximum streak', body: 'Finish today’s flashcards and call it a win.' },
  { title: 'The quiz is getting lonely', body: 'It wrote you questions and everything.' },
  { title: 'Daily dose of smart', body: 'Lesson, quiz or flashcards. Pick your flavour.' },
  { title: 'Down the rabbit hole we go', body: 'One more note deep. It only takes a few minutes.' },
  { title: 'Your brain has entered sleep mode', body: 'Wake it up with a quick quiz.' },
  { title: 'Reminder from future you', body: '“Thanks for doing a lesson today.” — Future You' },
  { title: 'Streak status: wobbly', body: 'Steady it with a round of flashcards.' },
  { title: 'This is not spam', body: 'This is a very polite rabbit asking you to learn something.' },
  { title: 'Five minutes. That’s it.', body: 'That is all today’s lesson needs from you.' },
  { title: 'Quiz o’clock', body: 'It is always quiz o’clock somewhere. Specifically, here.' },
  { title: 'Your notes are gossiping', body: 'They say you haven’t visited in a day. Prove them wrong.' },
  { title: 'Level up available', body: 'Finish one lesson to claim it.' },
  { title: 'Psst', body: 'The flashcards told me you’d come back. Don’t make them liars.' },
  { title: 'Keep the hole digging', body: 'A lesson, a quiz or some flashcards. The rabbit isn’t picky.' },
]

export function freezeUsedMessage(freezesLeft: number, days: number): PushMessage {
  const left =
    freezesLeft === 0
      ? 'That was your last one — miss today and the streak resets.'
      : `You have ${freezesLeft} left.`
  return {
    title: 'A streak freeze was used 🧊',
    body: `You missed yesterday, so a freeze saved your ${days}-day streak. ${left} Do a lesson, quiz or flashcards today to keep it going.`,
  }
}
