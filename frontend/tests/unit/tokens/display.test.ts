import { describe, expect, it } from 'vitest';
import { modelConfig } from '../../../src/lib/model/config';
import { bytesHex, tokenDisplay } from '../../../src/lib/tokens/display';

const utf8 = (s: string) => Array.from(new TextEncoder().encode(s));
// Any non-EOS id: display depends only on the bytes.
const ID = 0;

describe('tokenDisplay', () => {
  it('flags a leading space and keeps the rest as text', () => {
    expect(tokenDisplay(utf8(' the'), ID)).toEqual({
      kind: 'text',
      text: 'the',
      leadingSpace: true,
      newline: false,
      hex: '20 74 68 65',
    });
  });

  it('shows a newline as ⏎', () => {
    expect(tokenDisplay(utf8('\n'), ID)).toMatchObject({
      kind: 'text',
      text: '⏎',
      newline: true,
      leadingSpace: false,
    });
    expect(tokenDisplay(utf8('\n\n'), ID).text).toBe('⏎⏎');
  });

  it('never renders a token as blank', () => {
    expect(tokenDisplay(utf8(' '), ID)).toMatchObject({ text: '', leadingSpace: true });
    expect(tokenDisplay(utf8('   '), ID)).toMatchObject({ text: '␣␣', leadingSpace: true });
  });

  it('shows the bytes of an emoji split across tokens', () => {
    const emoji = utf8('🙂'); // F0 9F 99 82
    const first = tokenDisplay(emoji.slice(0, 2), ID);
    const second = tokenDisplay(emoji.slice(2), ID);
    expect(first).toMatchObject({ kind: 'partial', text: '⟨F0 9F⟩', hex: 'F0 9F' });
    expect(second).toMatchObject({ kind: 'partial', text: '⟨99 82⟩' });
    expect(tokenDisplay(emoji, ID)).toMatchObject({ kind: 'text', text: '🙂' });
  });

  it('shows the bytes of an accented letter split across tokens', () => {
    const cafe = utf8(' café'); // ... 63 61 66 C3 A9
    expect(tokenDisplay(cafe.slice(0, 5), ID)).toMatchObject({
      kind: 'partial',
      text: '⟨20 63 61 66 C3⟩',
    });
    expect(tokenDisplay(cafe.slice(5), ID)).toMatchObject({ kind: 'partial', text: '⟨A9⟩' });
    expect(tokenDisplay(cafe, ID)).toMatchObject({
      kind: 'text',
      text: 'café',
      leadingSpace: true,
    });
  });

  it('labels the end-of-text token', () => {
    expect(tokenDisplay(utf8('<|endoftext|>'), modelConfig.eosTokenId)).toMatchObject({
      kind: 'eos',
      leadingSpace: false,
    });
  });

  it('formats bytes as hex', () => {
    expect(bytesHex([0, 10, 255])).toBe('00 0A FF');
  });
});
