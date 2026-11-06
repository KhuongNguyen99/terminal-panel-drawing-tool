export const CABLE_LABEL_COLORS = Object.freeze([
  '#e53935', '#1565c0', '#fbc02d', '#2e7d32', '#ef6c00', '#7b1fa2',
]);

/** Cable colors remain stable when labels are added, moved, copied, or reopened. */
export function cableLabelColor(cable) {
  const key = String(cable ?? '').trim().toUpperCase();
  if (!key) return null;
  let hash = 0;
  for (const character of key) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
  return CABLE_LABEL_COLORS[hash % CABLE_LABEL_COLORS.length];
}
