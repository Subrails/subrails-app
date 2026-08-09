/**
 * Display formatting helpers. Token amounts are bigint in token base units
 * everywhere in the SDK and are only formatted to a display string here, at
 * the UI edge.
 */

/** Shortens a Stellar address for display: GA7Q...7V2F */
export function shortenAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 1) {
    return address;
  }
  return `${address.slice(0, lead)}\u2026${address.slice(-tail)}`;
}

/**
 * Formats a bigint token amount (base units) with the token's decimals into
 * a display string, e.g. 1000000 with 6 decimals -> "1".
 */
export function formatTokenAmount(base: bigint, decimals: number): string {
  const negative = base < 0n;
  const abs = negative ? -base : base;
  const padded = abs.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals) || "0";
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  const body = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return `${negative ? "-" : ""}${body}`;
}

/** Formats a bigint base-unit amount for input hints, e.g. "1" with 6 decimals -> 1000000. */
export function toBaseUnits(human: string, decimals: number): bigint {
  const trimmed = human.trim();
  if (trimmed === "") {
    throw new Error("Enter an amount.");
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (match === null) {
    throw new Error(`"${trimmed}" is not a valid amount.`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = match[2] ?? "0";
  const fraction = (match[3] ?? "").padEnd(decimals, "0").slice(0, decimals);
  return sign * (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction === "" ? "0" : fraction));
}

/**
 * Describes a ledger span in human terms. Stellar ledgers close about every
 * 5 seconds on the public networks.
 */
export function ledgerSpanLabel(ledgers: number): string {
  const seconds = ledgers * 5;
  if (seconds < 60) {
    return `${ledgers} ledgers (~${seconds}s)`;
  }
  if (seconds < 3600) {
    return `${ledgers} ledgers (~${Math.round(seconds / 60)} min)`;
  }
  if (seconds < 86400) {
    return `${ledgers} ledgers (~${(seconds / 3600).toFixed(1)} h)`;
  }
  return `${ledgers} ledgers (~${Math.round(seconds / 86400)} d)`;
}

/** Formats a ledger number with thousands separators. */
export function formatLedger(ledger: number | bigint): string {
  return ledger.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Formats a transaction hash for display. */
export function shortenHash(hash: string, lead = 8, tail = 6): string {
  if (hash.length <= lead + tail) {
    return hash;
  }
  return `${hash.slice(0, lead)}\u2026${hash.slice(-tail)}`;
}
