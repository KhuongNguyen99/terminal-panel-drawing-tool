import { FOUR_WIRE_ORDER_REVISION, deviceWidth, deviceHeight, tagWidth, tagHeight, geometry, makeId, normalizeProject, snap } from './model.js';

const FORMAT = 'wirebench-labels';
const MAX_NODES = 500;
const MAX_TEXT_LENGTH = 512 * 1024;
const NODE_MARGIN = 20;
const WIRE_MARGIN = 10;
const SEARCH_RADIUS = 12;
const POSITION_MIN = -10000;
const POSITION_MAX = 20000;
const isLabel = node => node?.kind === 'device' || node?.kind === 'tag';
const sizeOf = node => node.kind === 'tag'
  ? { width: tagWidth(node), height: tagHeight(node) }
  : { width: deviceWidth(node), height: deviceHeight(node) };
const rect = (x, y, width, height, margin = 0) => ({ left: x - margin, top: y - margin, right: x + width + margin, bottom: y + height + margin });
const overlaps = (a, b) => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
const invalidClipboard = () => new Error('The clipboard does not contain valid WireBench device labels or connector tags. Copy the labels again.');

function sanitizeFragment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== FORMAT || value.version !== 1 ||
      !Array.isArray(value.nodes) || !value.nodes.length || value.nodes.length > MAX_NODES) return null;
  if (value.nodes.some(node => !node || typeof node !== 'object' || Array.isArray(node) || !isLabel(node) ||
      typeof node.id !== 'string' || !/^[a-zA-Z0-9_-]{1,90}$/.test(node.id) ||
      ![node.x, node.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= POSITION_MIN && n <= POSITION_MAX))) return null;
  try {
    // Clipboard version 1 uses the current conductor order. Normalization must
    // not migrate an already copied four-wire cable's white/green colors.
    const normalized = normalizeProject({ version: 1, nodes: value.nodes, wires: [],
      fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION }, {});
    return { format: FORMAT, version: 1, nodes: normalized.nodes };
  } catch { return null; }
}

function nodeBounds(nodes) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const node of nodes) {
    const size = sizeOf(node);
    left = Math.min(left, node.x); top = Math.min(top, node.y);
    right = Math.max(right, node.x + size.width); bottom = Math.max(bottom, node.y + size.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Copy only editable labels; source assignments, modules, and wires are omitted. */
export function createLabelClipboard(nodes, selectedIds) {
  if (!Array.isArray(nodes)) return null;
  const selected = new Set(selectedIds || []);
  return sanitizeFragment({ format: FORMAT, version: 1,
    nodes: nodes.filter(node => isLabel(node) && selected.has(node.id)) });
}

export function serializeLabelClipboard(fragment) {
  const sanitized = sanitizeFragment(fragment);
  if (!sanitized) throw invalidClipboard();
  const text = JSON.stringify(sanitized);
  if (text.length > MAX_TEXT_LENGTH) throw new Error('These labels are too large to copy. Select fewer labels and try again.');
  return text;
}

/** Unrelated or malformed clipboard text is never treated as project content. */
export function parseLabelClipboard(text) {
  if (typeof text !== 'string' || !text.length || text.length > MAX_TEXT_LENGTH) return null;
  try { return sanitizeFragment(JSON.parse(text)); } catch { return null; }
}

/** The actual group footprint, without export or selection-ring padding. */
export function labelClipboardBounds(fragment) {
  const sanitized = sanitizeFragment(fragment);
  if (!sanitized) throw invalidClipboard();
  return nodeBounds(sanitized.nodes);
}

function visibleWireAreas(routes) {
  const areas = [];
  for (const route of Object.values(routes?.routes || routes || {})) {
    if (!Array.isArray(route?.points)) continue;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i];
      if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) continue;
      areas.push({ left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) });
    }
  }
  return areas;
}

/** Prepare an atomic paste. The caller appends the returned unwired labels. */
export function prepareLabelPaste(project, fragment, types, { desired, routes = {} } = {}) {
  const sanitized = sanitizeFragment(fragment);
  if (!sanitized) throw invalidClipboard();
  if (project.nodes.length + sanitized.nodes.length > MAX_NODES) {
    throw new Error('Pasting these labels would exceed the project limit of 500 items. Remove unused items or copy fewer labels.');
  }
  if (![desired?.x, desired?.y].every(Number.isFinite)) throw new Error('Choose a valid canvas position before pasting labels.');
  const bounds = nodeBounds(sanitized.nodes);
  const grid = [5, 10, 20].includes(Number(project.settings?.grid)) ? Number(project.settings.grid) : 10;
  const snapToGrid = project.settings?.snap !== false;
  const origin = { x: snapToGrid ? snap(desired.x, grid) : desired.x, y: snapToGrid ? snap(desired.y, grid) : desired.y };
  const step = Math.ceil(Math.max(40, (Math.min(bounds.width, bounds.height) + NODE_MARGIN + grid) / SEARCH_RADIUS) / grid) * grid;
  const offsets = sanitized.nodes.map(node => ({ x: node.x - bounds.x, y: node.y - bounds.y, ...sizeOf(node) }));
  const maxXOffset = Math.max(...offsets.map(node => node.x)), maxYOffset = Math.max(...offsets.map(node => node.y));
  const obstacles = geometry(project.nodes, types).obstacles.map(o => rect(o.x, o.y, o.width, o.height));
  const wireAreas = visibleWireAreas(routes);
  const candidates = [];
  for (let row = -SEARCH_RADIUS; row <= SEARCH_RADIUS; row++) for (let column = -SEARCH_RADIUS; column <= SEARCH_RADIUS; column++) {
    candidates.push({ x: origin.x + column * step, y: origin.y + row * step, distance: row * row + column * column });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
  let position = null;
  for (const candidate of candidates) {
    const { x, y } = candidate;
    if (x < POSITION_MIN || x + maxXOffset > POSITION_MAX || y < POSITION_MIN || y + maxYOffset > POSITION_MAX) continue;
    const nodeEnvelope = rect(x, y, bounds.width, bounds.height, NODE_MARGIN);
    const wireEnvelope = rect(x, y, bounds.width, bounds.height, WIRE_MARGIN);
    const nearbyNodes = obstacles.filter(o => overlaps(nodeEnvelope, o));
    const nearbyWires = wireAreas.filter(o => overlaps(wireEnvelope, o));
    const clear = offsets.every(node => {
      const nodeArea = rect(x + node.x, y + node.y, node.width, node.height, NODE_MARGIN);
      if (nearbyNodes.some(obstacle => overlaps(nodeArea, obstacle))) return false;
      const wireArea = rect(x + node.x, y + node.y, node.width, node.height, WIRE_MARGIN);
      return !nearbyWires.some(segment => overlaps(wireArea, segment));
    });
    if (clear) { position = { x, y }; break; }
  }
  if (!position) throw new Error('There is not enough clear space to paste these labels together. Pan to an open area or copy fewer labels and try again.');
  const usedIds = new Set([...project.nodes, ...(project.wires || []), ...sanitized.nodes].map(item => item.id));
  const nodes = sanitized.nodes.map((node, index) => {
    const base = makeId(node.kind === 'tag' ? 'tag' : 'dev');
    let id = base, suffix = 2;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    usedIds.add(id);
    return { ...node, id, x: position.x + offsets[index].x, y: position.y + offsets[index].y };
  });
  return { nodes, bounds: { ...position, width: bounds.width, height: bounds.height } };
}
