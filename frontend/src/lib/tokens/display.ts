// How a token's raw bytes are shown (research R9). GPT-2 tokens are byte sequences: a token can
// start with a space, contain line breaks, or hold only part of a UTF-8 character. Spaces and
// line breaks get visible markers; partial characters are shown as their byte values.
import { modelConfig } from '../model/config';

export const SPACE_MARKER = '␣';
export const NEWLINE_MARKER = '⏎';

export type TokenKind = 'text' | 'partial' | 'eos';

export interface TokenDisplay {
  kind: TokenKind;
  /**
   * Text to show. A leading space is not included (see `leadingSpace`), line breaks are shown as
   * ⏎, and a token made only of spaces shows them as ␣, so no token renders as blank. For a
   * partial character it is the byte values, e.g. "⟨E2 80⟩".
   */
  text: string;
  /** The token starts with a space; render a subtle ␣ before `text`. */
  leadingSpace: boolean;
  /** The token contains a line break (shown as ⏎ in `text`). */
  newline: boolean;
  /** Byte values in hex, e.g. "E2 80". */
  hex: string;
}

const decoder = new TextDecoder('utf-8', { fatal: true });

export function bytesHex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

export function tokenDisplay(bytes: readonly number[], id: number): TokenDisplay {
  const hex = bytesHex(bytes);
  if (id === modelConfig.eosTokenId) {
    return { kind: 'eos', text: '<|endoftext|>', leadingSpace: false, newline: false, hex };
  }
  let decoded: string;
  try {
    decoded = decoder.decode(new Uint8Array(bytes));
  } catch {
    return { kind: 'partial', text: `⟨${hex}⟩`, leadingSpace: false, newline: false, hex };
  }
  const leadingSpace = decoded.startsWith(' ');
  let text = leadingSpace ? decoded.slice(1) : decoded;
  const newline = text.includes('\n');
  text = text.replaceAll('\n', NEWLINE_MARKER);
  if (/^ +$/.test(text)) text = SPACE_MARKER.repeat(text.length);
  return { kind: 'text', text, leadingSpace, newline, hex };
}
