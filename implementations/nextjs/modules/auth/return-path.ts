/** Only same-site absolute paths are allowed after login, so `next` cannot become an open redirect. */
export function safeReturnPath(value: FormDataEntryValue | string | null | undefined): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}
