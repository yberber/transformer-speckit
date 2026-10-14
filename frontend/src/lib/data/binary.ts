// Decoder for the raw little-endian arrays shared by the static example files and the API's
// EncodedArray (contracts/example-data.md, "Binary encoding"). Fails closed: a buffer whose size
// does not match its declared shape is rejected, never partly shown.
import type { components } from '../../generated/api-types';

export type Dtype = 'float32' | 'uint16';
export type EncodedArray = components['schemas']['EncodedArray'];

export interface ArraySpec {
  dtype: Dtype;
  shape: number[];
  /** Real value = stored × scale (absent = 1). */
  scale?: number;
}

export class DataFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataFormatError';
  }
}

const BYTES_PER_VALUE: Record<Dtype, number> = { float32: 4, uint16: 2 };

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export function shapeSize(shape: readonly number[]): number {
  if (shape.length === 0 || shape.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new DataFormatError(`invalid shape [${shape.join(', ')}]`);
  }
  return shape.reduce((a, b) => a * b, 1);
}

export function decodeBinary(buf: ArrayBuffer, spec: ArraySpec): Float32Array {
  if (!LITTLE_ENDIAN) throw new DataFormatError('big-endian platforms are not supported');
  const perValue = BYTES_PER_VALUE[spec.dtype];
  if (perValue === undefined) throw new DataFormatError(`unknown dtype ${String(spec.dtype)}`);
  const expected = shapeSize(spec.shape) * perValue;
  if (buf.byteLength !== expected) {
    throw new DataFormatError(`expected ${expected} bytes, got ${buf.byteLength}`);
  }
  const scale = spec.scale ?? 1;
  if (spec.dtype === 'float32') {
    const values = new Float32Array(buf.slice(0));
    if (scale !== 1) for (let i = 0; i < values.length; i++) values[i]! *= scale;
    return values;
  }
  const stored = new Uint16Array(buf);
  const values = new Float32Array(stored.length);
  for (let i = 0; i < stored.length; i++) values[i] = stored[i]! * scale;
  return values;
}

function base64ToBuffer(data: string): ArrayBuffer {
  let binary: string;
  try {
    binary = atob(data);
  } catch {
    throw new DataFormatError('invalid base64 data');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function decodeEncodedArray(e: EncodedArray): Float32Array {
  return decodeBinary(base64ToBuffer(e.data), e);
}

// Attention is a packed causal lower triangle per head: (i, j), j ≤ i, sits at i(i+1)/2 + j.

export function packedIndex(i: number, j: number): number {
  return (i * (i + 1)) / 2 + j;
}

/** Number of packed entries for the first t rows, i.e. the data of a t-token prefix. */
export function prefixPackedLength(t: number): number {
  return (t * (t + 1)) / 2;
}

/** Row i of one head: the weights from token i to tokens 0..i. A view, not a copy. */
export function attentionRow(headData: Float32Array, i: number): Float32Array {
  const start = packedIndex(i, 0);
  if (i < 0 || start + i + 1 > headData.length) {
    throw new DataFormatError(`attention row ${i} outside the data`);
  }
  return headData.subarray(start, start + i + 1);
}
