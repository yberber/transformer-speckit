// The machine-readable JSON block at the end of gpt2-small.md, so tests compare against the
// same hand-derived values that the document explains line by line.
import { readFileSync } from 'node:fs';

export interface Gpt2SmallReference {
  config: Record<
    'n_embd' | 'n_layer' | 'n_head' | 'n_inner' | 'vocab_size' | 'n_positions',
    number
  >;
  params: {
    wte: number;
    wpe: number;
    block: Record<
      'ln_1' | 'attn.c_attn' | 'attn.c_proj' | 'ln_2' | 'mlp.c_fc' | 'mlp.c_proj',
      number
    >;
    per_block: number;
    all_blocks: number;
    ln_f: number;
    total: number;
  };
  decode_per_layer: Record<
    | 'qkv'
    | 'attn_scores_per_t'
    | 'attn_weighting_per_t'
    | 'attn_out'
    | 'mlp'
    | 'matmuls_without_attention',
    number
  >;
  all_layers_matmuls_without_attention: number;
  pos_add: number;
  lm_head: number;
  decode: Record<string, number>;
  prefill: Record<string, number>;
  kv_cache_bytes: Record<string, number>;
}

const markdown = readFileSync(new URL('./gpt2-small.md', import.meta.url), 'utf-8');
const block = /```json\n([\s\S]*?)\n```/.exec(markdown);
if (!block) throw new Error('gpt2-small.md has no ```json block');

export const gpt2Small = JSON.parse(block[1]!) as Gpt2SmallReference;
