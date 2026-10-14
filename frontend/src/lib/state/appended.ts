// The token that the last "Next token" press appended, so the chip that shows it can animate in
// (FR-036). Not reactive on purpose: a chip reads it once, when it is created. The mark expires
// quickly, so chips created later for other reasons (another example, another view) stay still.
const FRESH_MS = 1000;

let mark: { position: number; at: number } | null = null;

export function markAppended(position: number): void {
  mark = { position, at: Date.now() };
}

export function clearAppended(): void {
  mark = null;
}

/** True if the chip at `position` shows the token that was just appended. */
export function isJustAppended(position: number): boolean {
  return mark !== null && mark.position === position && Date.now() - mark.at < FRESH_MS;
}
