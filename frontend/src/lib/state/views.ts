// The views, in one dependency-free module so tests in any runner can import the same list.

export const VIEWS = [
  'tokens',
  'embeddings',
  'blocks',
  'attention',
  'prediction',
  'architecture',
  'cost',
  'method',
] as const;
export type ViewId = (typeof VIEWS)[number];

/** The "inside the machine" views, in the order data flows through the model (FR-021). */
export const FLOW_VIEWS = VIEWS.slice(0, 5) as readonly ViewId[];
export const REFERENCE_VIEWS = VIEWS.slice(5) as readonly ViewId[];

export function isView(v: unknown): v is ViewId {
  return VIEWS.includes(v as ViewId);
}
