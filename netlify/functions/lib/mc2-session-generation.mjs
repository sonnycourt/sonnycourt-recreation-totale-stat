export function sameMc2Generation(row, supplied) {
  const current = Number(row?.session_generation || 0);
  if (supplied == null) return current === 0;
  return Number.isSafeInteger(supplied) && supplied >= 0 && supplied === current;
}
export function generationFilter(row) {
  return `&session_generation=eq.${Number(row?.session_generation || 0)}`;
}
