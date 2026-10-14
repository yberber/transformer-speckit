// How a token is named for screen readers: "token 3: space, “cat”" (FR-035). Shared by the token
// chips and by announcements such as "added token 12" so both say the same thing.
import { t } from '../i18n/index';
import { NEWLINE_MARKER, SPACE_MARKER, tokenDisplay, type TokenDisplay } from './display';

const MARKER_RUN = new RegExp(`([${SPACE_MARKER}${NEWLINE_MARKER}]+)`);

/** The token's text in words: markers become "space" / "line break", text is quoted. */
export function spokenText(display: TokenDisplay): string {
  if (display.kind === 'eos') return t('token.eos');
  if (display.kind === 'partial') return t('token.partial', { hex: display.hex });
  const parts: string[] = [];
  if (display.leadingSpace) parts.push(t('token.space'));
  for (const run of display.text.split(MARKER_RUN)) {
    if (run === '') continue;
    if (run[0] !== SPACE_MARKER && run[0] !== NEWLINE_MARKER) {
      parts.push(`“${run}”`);
      continue;
    }
    for (const ch of run) parts.push(ch === NEWLINE_MARKER ? t('token.newline') : t('token.space'));
  }
  return parts.join(', ');
}

/** Accessible name of a token at a 0-based position, e.g. "token 3: space, “cat”, generated". */
export function tokenLabel(
  token: { id: number; bytes: readonly number[] },
  position: number,
  origin: 'input' | 'generated',
): string {
  const label = t('token.label', {
    position: position + 1,
    text: spokenText(tokenDisplay(token.bytes, token.id)),
  });
  return origin === 'generated' ? `${label}, ${t('token.generated')}` : label;
}
