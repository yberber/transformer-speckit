// Every weight matrix and bias of the model (data-model.md "ParamGroup"), with its shape, count
// and share of all parameters, computed from the model config (Principle I). The names are the
// Hugging Face state_dict names; tests/unit/model/params.test.ts compares every shape with the
// real state_dict and every count with the hand references (Principle II).
import type { ModelConfig } from './config';

export type ParamComponent =
  | 'wte'
  | 'wpe'
  | 'ln_1'
  | 'attn.c_attn'
  | 'attn.c_proj'
  | 'ln_2'
  | 'mlp.c_fc'
  | 'mlp.c_proj'
  | 'ln_f'
  | 'lm_head';

export type ParamKind = 'weight' | 'bias';

export interface ParamGroup {
  /** HF state_dict name, e.g. `h.0.attn.c_attn.weight` (blocks count from 0 here). */
  name: string;
  component: ParamComponent;
  kind: ParamKind;
  /** 1-based block number as shown in the UI; null outside the blocks. */
  layer: number | null;
  /** Linear weights are in HF Conv1D order (in × out). */
  shape: number[];
  count: number;
  /** count / total; 0 for a tied group, which is counted in the group it shares weights with. */
  share: number;
  /** Name of the group whose weights this one reuses (the LM head reuses wte). */
  tiedTo: string | null;
  formulaId: `params-${ParamComponent}`;
}

/** The groups inside one transformer block, in state_dict order. */
export const BLOCK_COMPONENTS = [
  'ln_1',
  'attn.c_attn',
  'attn.c_proj',
  'ln_2',
  'mlp.c_fc',
  'mlp.c_proj',
] as const satisfies readonly ParamComponent[];

type Draft = Omit<ParamGroup, 'count' | 'share' | 'formulaId'>;

function blockShapes(c: ModelConfig): Record<(typeof BLOCK_COMPONENTS)[number], number[][]> {
  const d = c.nEmbd;
  const f = c.nInner;
  return {
    ln_1: [[d], [d]],
    // Query, key and value projections in one matrix: d inputs, 3 × d outputs.
    'attn.c_attn': [[d, 3 * d], [3 * d]],
    'attn.c_proj': [[d, d], [d]],
    ln_2: [[d], [d]],
    'mlp.c_fc': [[d, f], [f]],
    'mlp.c_proj': [[f, d], [d]],
  };
}

function drafts(c: ModelConfig): Draft[] {
  const d = c.nEmbd;
  const out: Draft[] = [
    {
      name: 'wte.weight',
      component: 'wte',
      kind: 'weight',
      layer: null,
      shape: [c.vocabSize, d],
      tiedTo: null,
    },
    {
      name: 'wpe.weight',
      component: 'wpe',
      kind: 'weight',
      layer: null,
      shape: [c.nPositions, d],
      tiedTo: null,
    },
  ];
  const block = blockShapes(c);
  for (let layer = 1; layer <= c.nLayer; layer++) {
    for (const component of BLOCK_COMPONENTS) {
      const [weight, bias] = block[component];
      const prefix = `h.${layer - 1}.${component}`;
      out.push({
        name: `${prefix}.weight`,
        component,
        kind: 'weight',
        layer,
        shape: weight!,
        tiedTo: null,
      });
      out.push({
        name: `${prefix}.bias`,
        component,
        kind: 'bias',
        layer,
        shape: bias!,
        tiedTo: null,
      });
    }
  }
  out.push(
    {
      name: 'ln_f.weight',
      component: 'ln_f',
      kind: 'weight',
      layer: null,
      shape: [d],
      tiedTo: null,
    },
    { name: 'ln_f.bias', component: 'ln_f', kind: 'bias', layer: null, shape: [d], tiedTo: null },
    {
      name: 'lm_head.weight',
      component: 'lm_head',
      kind: 'weight',
      layer: null,
      shape: [c.vocabSize, d],
      tiedTo: c.tieWordEmbeddings ? 'wte.weight' : null,
    },
  );
  // Buffers such as the causal mask (`attn.bias`) are not parameters and are left out.
  return out;
}

const product = (shape: number[]) => shape.reduce((a, b) => a * b, 1);

/** All parameter groups, in state_dict order. Tied groups are listed but not counted. */
export function paramGroups(config: ModelConfig): ParamGroup[] {
  const groups = drafts(config).map((g) => ({ ...g, count: product(g.shape) }));
  const total = groups.reduce((sum, g) => (g.tiedTo === null ? sum + g.count : sum), 0);
  return groups.map((g) => ({
    ...g,
    share: g.tiedTo === null ? g.count / total : 0,
    formulaId: `params-${g.component}` as const,
  }));
}

/** Number of distinct parameters: tied weights are counted once. */
export function totalParams(config: ModelConfig): number {
  return paramGroups(config).reduce((sum, g) => (g.tiedTo === null ? sum + g.count : sum), 0);
}

/** Parameters of one transformer block (all blocks have the same size). */
export function perBlockParams(config: ModelConfig): number {
  return paramGroups(config)
    .filter((g) => g.layer === 1)
    .reduce((sum, g) => sum + g.count, 0);
}
