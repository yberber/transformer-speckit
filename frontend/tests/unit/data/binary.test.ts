import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DataFormatError,
  attentionRow,
  decodeBinary,
  decodeEncodedArray,
  packedIndex,
  prefixPackedLength,
  type ArraySpec,
} from '../../../src/lib/data/binary';

const FIXTURE = new URL('../../../../contracts/fixtures/data/tiny-example/', import.meta.url);

interface FileEntry extends ArraySpec {
  path: string;
  bytes: number;
}

const core = JSON.parse(readFileSync(new URL('core.json', FIXTURE), 'utf-8')) as {
  run: { tokens: unknown[] };
  files: { embeddings_token: FileEntry & { unique_ids: number[] }; attention: FileEntry[] };
};

function read(path: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(path, FIXTURE)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

const T = core.run.tokens.length;

describe('binary decoder on the tiny-example fixture', () => {
  it('decodes every file to the declared number of values', () => {
    for (const f of [core.files.embeddings_token, ...core.files.attention]) {
      const values = decodeBinary(read(f.path), f);
      expect(values.length).toBe(f.shape.reduce((a, b) => a * b, 1));
      expect(values.every(Number.isFinite)).toBe(true);
    }
    const emb = core.files.embeddings_token;
    expect(emb.shape[0]).toBe(emb.unique_ids.length);
  });

  it('rejects a buffer whose length does not match the shape', () => {
    const f = core.files.attention[0]!;
    const buf = read(f.path);
    expect(() => decodeBinary(buf.slice(0, buf.byteLength - 2), f)).toThrow(DataFormatError);
    expect(() => decodeBinary(new ArrayBuffer(buf.byteLength + 2), f)).toThrow(DataFormatError);
    expect(() => decodeBinary(buf, { ...f, shape: [] })).toThrow(DataFormatError);
  });

  it('gives attention rows that sum to 1 within the quantization error', () => {
    for (const f of core.files.attention) {
      const values = decodeBinary(read(f.path), f);
      const [heads, packed] = f.shape as [number, number];
      expect(packed).toBe(prefixPackedLength(T));
      for (let h = 0; h < heads; h++) {
        const head = values.subarray(h * packed, (h + 1) * packed);
        for (let i = 0; i < T; i++) {
          const row = attentionRow(head, i);
          expect(row.length).toBe(i + 1);
          const sum = row.reduce((a, b) => a + b, 0);
          // Each of the i + 1 weights is rounded by at most half a uint16 step, plus float32 error.
          expect(Math.abs(sum - 1)).toBeLessThanOrEqual((i + 1) * 2 ** -16 + 1e-6);
        }
      }
    }
  });

  it('gives the rows of a shorter prefix as a prefix of the packed data', () => {
    const f = core.files.attention[0]!;
    const head = decodeBinary(read(f.path), f).subarray(0, prefixPackedLength(T));
    for (let t = 1; t <= T; t++) {
      const prefix = head.subarray(0, prefixPackedLength(t));
      for (let i = 0; i < t; i++) {
        expect(Array.from(attentionRow(prefix, i))).toEqual(Array.from(attentionRow(head, i)));
      }
      expect(() => attentionRow(prefix, t)).toThrow(DataFormatError);
    }
  });

  it('decodes a base64 EncodedArray the same way as a file', () => {
    const f = core.files.attention[1]!;
    const buf = read(f.path);
    const data = Buffer.from(buf).toString('base64');
    expect(
      Array.from(decodeEncodedArray({ dtype: 'uint16', shape: f.shape, scale: f.scale, data })),
    ).toEqual(Array.from(decodeBinary(buf, f)));
    expect(() => decodeEncodedArray({ dtype: 'uint16', shape: [1], data: '%%%' })).toThrow(
      DataFormatError,
    );
  });

  it('computes packed indices', () => {
    expect([packedIndex(0, 0), packedIndex(1, 0), packedIndex(1, 1), packedIndex(2, 0)]).toEqual([
      0, 1, 2, 3,
    ]);
    expect(packedIndex(4, 4)).toBe(prefixPackedLength(5) - 1);
  });

  it('applies the scale to float32 values too', () => {
    const buf = new Float32Array([1, 2, 3]).buffer;
    expect(Array.from(decodeBinary(buf, { dtype: 'float32', shape: [3], scale: 0.5 }))).toEqual([
      0.5, 1, 1.5,
    ]);
  });
});
