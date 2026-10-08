export type ReadingSpeed = 'relaxed' | 'standard' | 'brisk'

export interface CommittedReadingMessage {
  eventSeq: number
  speakerId: string
  text: string
}

/** Input must come from a confirmed session, never provisional stream frames. */
export function latestCommittedDialogue<T extends CommittedReadingMessage>(messages: readonly T[]): T[] {
  if (!messages.length) return []
  const latest = Math.max(...messages.map((message) => message.eventSeq))
  return messages.filter(
    (message) =>
      message.eventSeq === latest &&
      ['narrator', 'lin', 'zhou', 'xu'].includes(message.speakerId) &&
      message.text.trim().length > 0,
  )
}

/** A full segment stays visible for 3–12 seconds; users can pause at any time. */
export function dialogueReadingDelay(text: string, speed: ReadingSpeed = 'standard'): number {
  const millisecondsPerCharacter: Record<ReadingSpeed, number> = { relaxed: 220, standard: 170, brisk: 120 }
  const characters = Array.from(text.replace(/\s/gu, '')).length
  return Math.min(12000, Math.max(3000, 1800 + characters * millisecondsPerCharacter[speed]))
}
