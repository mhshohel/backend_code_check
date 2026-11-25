// Deterministic UUIDs (version 4 layout, variant 8) so fixtures, tests, and
// documentation can refer to the same ids across resets.
export function fixtureId(namespace: number, n: number): string {
  if (!Number.isInteger(namespace) || namespace < 0 || namespace > 0xfff) throw new RangeError('namespace must be 0..4095');
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffffffff) throw new RangeError('n out of range');
  return `00000000-0000-4000-8${namespace.toString(16).padStart(3, '0')}-${n.toString(16).padStart(12, '0')}`;
}

export const NS = {
  warehouse: 1,
  user: 2,
  category: 3,
  product: 4,
  sku: 5,
  order: 6,
  orderLine: 7,
  reservation: 8,
  payment: 9,
  shipment: 10,
  return: 11,
  refund: 12,
} as const;

/** Small deterministic PRNG (mulberry32). Same seed, same data. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
