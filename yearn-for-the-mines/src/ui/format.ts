const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi"];
const THOUSAND = 1_000;

/** 950 -> "950", 12_345 -> "12.3K", 4_560_000 -> "4.56M". */
export function formatAmount(amount: number): string {
  if (amount < THOUSAND) return Math.floor(amount).toString();
  let tier = 0;
  let scaled = amount;
  while (scaled >= THOUSAND && tier < SUFFIXES.length - 1) {
    scaled /= THOUSAND;
    tier += 1;
  }
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)}${SUFFIXES[tier]}`;
}

export function formatGold(amount: number): string {
  return `$${formatAmount(amount)}`;
}
