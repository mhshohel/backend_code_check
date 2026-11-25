export type PageSearchParams = Record<string, string | string[] | undefined>;

export function firstParam(params: PageSearchParams, name: string): string | null {
  const value = params[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === '' ? null : first;
}
