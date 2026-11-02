export function formatShort(value) {
  if (value < 10) return value.toFixed(1);
  if (value < 1000) return Math.round(value).toString();
  const units = ["K", "M", "B", "T", "Qa", "Qi"];
  let scaled = value;
  let unit = -1;
  while (scaled >= 1000 && unit < units.length - 1) {
    scaled /= 1000;
    unit += 1;
  }
  if (scaled >= 1000) return value.toExponential(2);
  return `${scaled < 100 ? scaled.toFixed(1) : Math.round(scaled)}${units[unit]}`;
}
