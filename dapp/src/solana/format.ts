// Dates and fees as the screens say them: "14 Nov", "23 Oct, 18:40", "2.5%".

function toDate(unixSeconds: bigint | number): Date {
  return new Date(Number(unixSeconds) * 1000);
}

export function formatDay(unixSeconds: bigint | number): string {
  const d = toDate(unixSeconds);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" });
}

export function formatTime(unixSeconds: bigint | number): string {
  return toDate(unixSeconds).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function formatDayTime(unixSeconds: bigint | number): string {
  return `${formatDay(unixSeconds)}, ${formatTime(unixSeconds)}`;
}

/**
 * An offer's `expires_at` is the instant it stops taking orders (inclusive), so the last day a customer
 * can order is the day of the second before it.
 */
export function formatOfferExpiry(expiresAt: bigint | number): string {
  return formatDay(Number(expiresAt) - 1);
}

/** The instant that ends the given local calendar day ("2026-11-14" -> 15 Nov 00:00 local). */
export function endOfLocalDay(isoDate: string): bigint | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const next = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1, 0, 0, 0, 0);
  return BigInt(Math.floor(next.getTime() / 1000));
}

export function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

export function formatFeeBps(feeBps: number): string {
  return `${(feeBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

export function shortKey(value: string, head = 4, tail = 4): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** "Order #26179200" ids are seconds since 2026-01-01 UTC: unique per customer and offer, and ordered. */
const ID_EPOCH = Date.UTC(2026, 0, 1) / 1000;
export function freshId(): bigint {
  return BigInt(Math.floor(Date.now() / 1000 - ID_EPOCH));
}
