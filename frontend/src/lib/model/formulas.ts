// Every formula behind the parameter counts, FLOP estimates and KV-cache size, as documented on
// "How we calculate" (FR-028). Each entry is keyed by the formula id that params.ts, flops.ts and
// kvcache.ts put on their values (FR-027), names its inputs and gives the expression in plain-text
// notation. The worked values call those same functions and never repeat the math, so the page
// always shows what the rest of the site computes (US8-3).
// tests/unit/model/formulas.test.ts checks the registry is complete in every locale.
import type { MessageKey } from '../i18n/index';
import type { ModelConfig } from './config';
import { decodeFlops, FORMULA_IDS, prefillFlops, runningTotalFlops } from './flops';
import type { FlopBreakdown, LayerComponent } from './flops';
import { kvCacheBytes } from './kvcache';
import { BLOCK_COMPONENTS, paramGroups, perBlockParams, totalParams } from './params';
import type { ParamComponent, ParamKind } from './params';

/** Config fields (by their config key) and token counts a formula can use. */
export type FormulaInput =
  'n_embd' | 'n_layer' | 'n_head' | 'n_inner' | 'vocab_size' | 'n_positions' | 'n' | 't';

/** The token counts of a worked example: n input tokens, context length t. */
export interface WorkedArgs {
  n: number;
  t: number;
}

export interface FormulaVariant {
  /** Caption where a formula has several parts (prefill/decode, weight/bias); null otherwise. */
  labelKey: MessageKey | null;
  /** Plain-text notation in the symbols of INPUT_SYMBOLS, e.g. "6 · d² · n". */
  expression: string;
  /** The value for the given config and token counts, from params.ts/flops.ts/kvcache.ts. */
  worked: (config: ModelConfig, args: WorkedArgs) => number;
}

export type FormulaGroup = 'params' | 'flops' | 'memory';

export interface Formula {
  id: string;
  group: FormulaGroup;
  titleKey: MessageKey;
  inputs: FormulaInput[];
  variants: FormulaVariant[];
  /** The value is a theoretical estimate (FLOPs, memory), not an exact count. */
  isEstimate: boolean;
  /** The value is for one transformer block; every block has the same size. */
  perLayer: boolean;
}

/** The symbol of each input in the expressions. */
export const INPUT_SYMBOLS: Record<FormulaInput, string> = {
  n_embd: 'd',
  n_layer: 'L',
  n_head: 'H',
  n_inner: 'f',
  vocab_size: 'V',
  n_positions: 'P',
  n: 'n',
  t: 't',
};

const CONFIG_FIELDS = {
  n_embd: 'nEmbd',
  n_layer: 'nLayer',
  n_head: 'nHead',
  n_inner: 'nInner',
  vocab_size: 'vocabSize',
  n_positions: 'nPositions',
} as const satisfies Partial<Record<FormulaInput, keyof ModelConfig>>;

export function isConfigInput(input: FormulaInput): input is keyof typeof CONFIG_FIELDS {
  return input in CONFIG_FIELDS;
}

/** The value of an input: read from the config, or the worked example's token count. */
export function inputValue(config: ModelConfig, input: FormulaInput, args: WorkedArgs): number {
  return isConfigInput(input) ? (config[CONFIG_FIELDS[input]] as number) : args[input];
}

/** i18n key of the plain-language name of an input. */
export function inputLabelKey(input: FormulaInput): MessageKey {
  return `method.input.${input}`;
}

const SYMBOL_INPUTS = new Map(
  Object.entries(INPUT_SYMBOLS).map(([input, symbol]) => [symbol, input as FormulaInput]),
);

/**
 * The expression with every symbol replaced by its value (with n = 10, "d · n" becomes the
 * config's n_embd followed by "· 10"), so a visitor can recompute the worked example by hand. Function names (prefill, decode) and
 * the summation indices j and k are left as they are.
 */
export function substitute(expression: string, value: (input: FormulaInput) => string): string {
  return expression.replace(/(?<![\p{L}\p{Nd}_])[dLHfVPnt](?![\p{L}\p{Nd}_(])/gu, (symbol) =>
    value(SYMBOL_INPUTS.get(symbol)!),
  );
}

/** Generated tokens in a context of t tokens after n input tokens. */
export function generatedTokens(args: WorkedArgs): number {
  return Math.max(0, args.t - args.n);
}

// --- parameters ---------------------------------------------------------------------------

function paramCount(
  config: ModelConfig,
  component: ParamComponent,
  kind: ParamKind = 'weight',
): number {
  // Every block has the same size: block 1 stands for all of them.
  const group = paramGroups(config).find(
    (g) => g.component === component && g.kind === kind && (g.layer === null || g.layer === 1),
  );
  if (!group) throw new Error(`no ${kind} for ${component}`);
  return group.count;
}

function paramFormula(
  component: ParamComponent,
  titleKey: MessageKey,
  inputs: FormulaInput[],
  weight: string,
  bias: string | null,
): Formula {
  const part = (kind: ParamKind, expression: string): FormulaVariant => ({
    labelKey: bias === null ? null : `method.variant.${kind}`,
    expression,
    worked: (config) => paramCount(config, component, kind),
  });
  return {
    id: `params-${component}`,
    group: 'params',
    titleKey,
    inputs,
    variants:
      bias === null ? [part('weight', weight)] : [part('weight', weight), part('bias', bias)],
    isEstimate: false,
    perLayer: (BLOCK_COMPONENTS as readonly ParamComponent[]).includes(component),
  };
}

const PARAMS: Formula[] = [
  paramFormula('wte', 'method.formula.params_wte', ['vocab_size', 'n_embd'], 'V · d', null),
  paramFormula('wpe', 'method.formula.params_wpe', ['n_positions', 'n_embd'], 'P · d', null),
  paramFormula('ln_1', 'method.formula.params_ln_1', ['n_embd'], 'd', 'd'),
  paramFormula(
    'attn.c_attn',
    'method.formula.params_attn_c_attn',
    ['n_embd'],
    'd · 3 · d',
    '3 · d',
  ),
  paramFormula('attn.c_proj', 'method.formula.params_attn_c_proj', ['n_embd'], 'd · d', 'd'),
  paramFormula('ln_2', 'method.formula.params_ln_2', ['n_embd'], 'd', 'd'),
  paramFormula('mlp.c_fc', 'method.formula.params_mlp_c_fc', ['n_embd', 'n_inner'], 'd · f', 'f'),
  paramFormula(
    'mlp.c_proj',
    'method.formula.params_mlp_c_proj',
    ['n_inner', 'n_embd'],
    'f · d',
    'd',
  ),
  paramFormula('ln_f', 'method.formula.params_ln_f', ['n_embd'], 'd', 'd'),
  paramFormula('lm_head', 'method.formula.params_lm_head', ['vocab_size', 'n_embd'], 'V · d', null),
  {
    id: 'params-block',
    group: 'params',
    titleKey: 'method.formula.params_block',
    inputs: ['n_embd', 'n_inner'],
    variants: [
      {
        labelKey: null,
        // 2 · 2d (layer norms) + (3d² + 3d) + (d² + d) + (d·f + f) + (f·d + d)
        expression: '4 · d² + 2 · d · f + 9 · d + f',
        worked: (config) => perBlockParams(config),
      },
    ],
    isEstimate: false,
    perLayer: false,
  },
  {
    id: 'params-total',
    group: 'params',
    titleKey: 'method.formula.params_total',
    inputs: ['vocab_size', 'n_positions', 'n_embd', 'n_layer', 'n_inner'],
    variants: [
      {
        labelKey: null,
        expression: 'V · d + P · d + L · (4 · d² + 2 · d · f + 9 · d + f) + 2 · d',
        worked: (config) => totalParams(config),
      },
    ],
    isEstimate: false,
    perLayer: false,
  },
];

// --- FLOPs --------------------------------------------------------------------------------

function item(b: FlopBreakdown, component: LayerComponent | 'pos_add' | 'lm_head'): number {
  // Every layer has the same cost: layer 1 stands for all of them (null outside the layers).
  const e = b.breakdown.find(
    (x) => x.component === component && (x.layer === null || x.layer === 1),
  );
  if (!e) throw new Error(`no ${component} in the ${b.total.phase} breakdown`);
  return e.value;
}

function phased(
  component: LayerComponent | 'pos_add',
  titleKey: MessageKey,
  inputs: FormulaInput[],
  prefill: string,
  decode: string,
): Formula {
  return {
    id: FORMULA_IDS[component],
    group: 'flops',
    titleKey,
    inputs,
    variants: [
      {
        labelKey: 'method.variant.prefill',
        expression: prefill,
        worked: (config, { n }) => item(prefillFlops(config, n), component),
      },
      {
        labelKey: 'method.variant.decode',
        expression: decode,
        worked: (config, { t }) => item(decodeFlops(config, t), component),
      },
    ],
    isEstimate: true,
    perLayer: component !== 'pos_add',
  };
}

const FLOPS: Formula[] = [
  phased('qkv', 'method.formula.flops_qkv', ['n_embd', 'n', 't'], '6 · d² · n', '6 · d²'),
  phased(
    'attn_scores',
    'method.formula.flops_attn_scores',
    ['n_embd', 'n', 't'],
    'd · n · (n + 1)',
    '2 · d · t',
  ),
  phased(
    'attn_weighting',
    'method.formula.flops_attn_weighting',
    ['n_embd', 'n', 't'],
    'd · n · (n + 1)',
    '2 · d · t',
  ),
  phased('attn_out', 'method.formula.flops_attn_out', ['n_embd', 'n', 't'], '2 · d² · n', '2 · d²'),
  phased(
    'mlp',
    'method.formula.flops_mlp',
    ['n_embd', 'n_inner', 'n', 't'],
    '4 · d · f · n',
    '4 · d · f',
  ),
  phased('pos_add', 'method.formula.flops_pos_add', ['n_embd', 'n', 't'], 'd · n', 'd'),
  {
    id: FORMULA_IDS.lm_head,
    group: 'flops',
    titleKey: 'method.formula.flops_lm_head',
    inputs: ['n_embd', 'vocab_size'],
    variants: [
      {
        labelKey: null,
        expression: '2 · d · V',
        // The same in both phases: only the last position is projected onto the vocabulary.
        worked: (config, { t }) => item(decodeFlops(config, t), 'lm_head'),
      },
    ],
    isEstimate: true,
    perLayer: false,
  },
  {
    id: FORMULA_IDS.prefill,
    group: 'flops',
    titleKey: 'method.formula.flops_prefill_total',
    inputs: ['n_layer', 'n_embd', 'n_inner', 'vocab_size', 'n'],
    variants: [
      {
        labelKey: null,
        expression: 'L · ((8 · d² + 4 · d · f) · n + 2 · d · n · (n + 1)) + d · n + 2 · d · V',
        worked: (config, { n }) => prefillFlops(config, n).total.value,
      },
    ],
    isEstimate: true,
    perLayer: false,
  },
  {
    id: FORMULA_IDS.decode,
    group: 'flops',
    titleKey: 'method.formula.flops_decode_total',
    inputs: ['n_layer', 'n_embd', 'n_inner', 'vocab_size', 't'],
    variants: [
      {
        labelKey: null,
        expression: 'L · (8 · d² + 4 · d · f + 4 · d · t) + d + 2 · d · V',
        worked: (config, { t }) => decodeFlops(config, t).total.value,
      },
    ],
    isEstimate: true,
    perLayer: false,
  },
  {
    id: FORMULA_IDS.running,
    group: 'flops',
    titleKey: 'method.formula.flops_running_total',
    inputs: ['n', 't'],
    variants: [
      {
        labelKey: null,
        expression: 'prefill(n) + Σⱼ₌₁..ₖ decode(n + j), k = t − n',
        worked: (config, args) => runningTotalFlops(config, args.n, generatedTokens(args)).value,
      },
    ],
    isEstimate: true,
    perLayer: false,
  },
];

// --- memory -------------------------------------------------------------------------------

const MEMORY: Formula[] = [
  {
    id: 'kv-cache-bytes',
    group: 'memory',
    titleKey: 'method.formula.kv_cache_bytes',
    inputs: ['n_layer', 'n_embd', 't'],
    variants: [
      {
        labelKey: null,
        expression: '2 · L · t · d · 4',
        worked: (config, { t }) => kvCacheBytes(config, t).value,
      },
    ],
    isEstimate: true,
    perLayer: false,
  },
];

/** Every formula, in the order of the page: parameters, FLOPs, memory. */
export const FORMULA_LIST: readonly Formula[] = [...PARAMS, ...FLOPS, ...MEMORY];

export const FORMULAS: Readonly<Record<string, Formula>> = Object.fromEntries(
  FORMULA_LIST.map((f) => [f.id, f]),
);
