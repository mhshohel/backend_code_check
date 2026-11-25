/**
 * Parses a dollar amount typed by a person ("12", "12.5", "12.50") into
 * integer cents without floating-point arithmetic. Returns null when invalid.
 */
export function parseMoneyInput(text: string): number | null {
  const match = /^\s*\$?(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!match) return null;
  const whole = Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  return whole * 100 + cents;
}
