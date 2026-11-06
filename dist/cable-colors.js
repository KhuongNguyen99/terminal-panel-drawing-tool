import { focusNodesForModule } from './schedule-navigation.js';

export const CABLE_LABEL_COLORS = Object.freeze([
  '#e53935', '#1565c0', '#fbc02d', '#2e7d32', '#ef6c00', '#7b1fa2',
]);

const cableKey = cable => String(cable ?? '').trim().toUpperCase();

export function cableBoxColor(node) {
  const color = typeof node?.boxColor === 'string' ? node.boxColor.toLowerCase() : '';
  return CABLE_LABEL_COLORS.includes(color) ? color : undefined;
}

/** Resolve conflicting imported overrides by stable item ID, so every matching label agrees. */
export function cableBoxColorOverride(node, project) {
  const key = cableKey(node.cable);
  if (!key) return cableBoxColor(node);
  const matching = project.nodes.filter(other => other.kind === 'device' &&
    cableKey(other.cable) === key && cableBoxColor(other));
  matching.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return cableBoxColor(matching[0]);
}

/** Manual colors apply to the whole matching cable group; blank numbers stay independent. */
export function setCableBoxColor(project, selectedIds, color) {
  if (color !== '' && !cableBoxColor({ boxColor: color })) return false;
  const selected = new Set(selectedIds), cables = new Set();
  for (const node of project.nodes) if (node.kind === 'device' && selected.has(node.id) && cableKey(node.cable)) cables.add(cableKey(node.cable));
  for (const node of project.nodes) if (node.kind === 'device' && (selected.has(node.id) || (cableKey(node.cable) && cables.has(cableKey(node.cable))))) {
    if (color === '') delete node.boxColor; else node.boxColor = cableBoxColor({ boxColor: color });
  }
  return true;
}

/** Unassigned cables use a stable fallback; matching numbers always share a color. */
export function cableLabelColor(cable, colors) {
  const key = cableKey(cable);
  if (!key) return null;
  if (colors?.has(key)) return colors.get(key);
  let hash = 0;
  for (const character of key) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
  return CABLE_LABEL_COLORS[hash % CABLE_LABEL_COLORS.length];
}
/** Prefer distinct cable colors per module; use the fewest conflicts when six are insufficient. */
export function assignCableLabelColors(project) {
  const colors = new Map(), neighbors = new Map(), assigned = new Map();
  for (const node of project.nodes) if (node.kind === 'device' && cableKey(node.cable)) {
    colors.set(cableKey(node.cable), cableLabelColor(node.cable));
    const override = cableBoxColorOverride(node, project);
    if (override) assigned.set(cableKey(node.cable), override);
  }
  for (const [cable, color] of assigned) colors.set(cable, color);
  for (const module of project.nodes.filter(node => node.kind === 'module')) {
    const cables = new Set(focusNodesForModule(module.id, project)
      .filter(node => node.kind === 'device').map(node => cableKey(node.cable)).filter(Boolean));
    for (const cable of cables) {
      if (!neighbors.has(cable)) neighbors.set(cable, new Set());
      for (const other of cables) if (other !== cable) neighbors.get(cable).add(other);
    }
  }
  const remaining = new Set([...neighbors.keys()].filter(cable => !assigned.has(cable)).sort());
  const usedColors = new Map([...remaining].map(cable => [cable,
    new Set([...neighbors.get(cable)].filter(other => assigned.has(other)).map(other => assigned.get(other)))]));
  while (remaining.size) {
    let cable;
    for (const candidate of remaining) {
      if (cable === undefined || usedColors.get(candidate).size > usedColors.get(cable).size ||
          (usedColors.get(candidate).size === usedColors.get(cable).size && neighbors.get(candidate).size > neighbors.get(cable).size)) cable = candidate;
    }
    const conflicts = CABLE_LABEL_COLORS.map(color =>
      [...neighbors.get(cable)].filter(other => assigned.get(other) === color).length);
    let chosen = CABLE_LABEL_COLORS.indexOf(cableLabelColor(cable));
    for (let index = 0; index < conflicts.length; index++) if (conflicts[index] < conflicts[chosen]) chosen = index;
    const color = CABLE_LABEL_COLORS[chosen];
    assigned.set(cable, color); colors.set(cable, color); remaining.delete(cable);
    for (const other of neighbors.get(cable)) if (remaining.has(other)) usedColors.get(other).add(color);
  }
  return colors;
}
