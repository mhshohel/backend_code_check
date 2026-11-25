import type { OrderDetailFieldsFragment } from '@ofl/graphql-types';

/**
 * The order can arrive from three places: the server render, a mutation
 * response, and the subscription. Keep whichever is newest by updatedAt so a
 * late, older event never overwrites a newer state.
 */
export function newerOrder(
  current: OrderDetailFieldsFragment,
  candidate: OrderDetailFieldsFragment | null | undefined,
): OrderDetailFieldsFragment {
  if (!candidate || candidate.id !== current.id) return current;
  return Date.parse(candidate.updatedAt) >= Date.parse(current.updatedAt) ? candidate : current;
}
