import { normalizeManualRoute } from './manual-routing.js';

export const CONDUCTORS = {
  2: [{ key: 'black', name: 'Black', color: '#202631' }, { key: 'white', name: 'White', color: '#ffffff' }],
  4: [{ key: 'red', name: 'Red', color: '#e54b4b' }, { key: 'black', name: 'Black', color: '#202631' }, { key: 'white', name: 'White', color: '#ffffff' }, { key: 'green', name: 'Green', color: '#2b9b68' }]
};
export const FOUR_WIRE_ORDER_REVISION = 'white-before-green-v1';
export const DEVICE_WIDTH = 210;
export const DEVICE_HEIGHT = 60;
export const DEVICE_MIN_WIDTH = 160;
export const DEVICE_MAX_WIDTH = 1000;
export const DEVICE_MAX_HEIGHT = 600;
export const deviceMinHeight = () => 60;
export const TAG_WIDTH = 160;
export const TAG_HEIGHT = 40;
export const TAG_MIN_WIDTH = 80;
export const TAG_MAX_WIDTH = 1000;
export const TAG_MIN_HEIGHT = 30;
export const TAG_MAX_HEIGHT = 600;

export const tagName = value => value == null ? 'NET1' : String(value).trim().slice(0, 64).trim();
export const tagNameKey = value => String(value ?? '').trim().toLowerCase();

/** Matching names describe a virtual connection; they never create physical wires. */
export function matchingTags(nodes, tag) {
  const key = tag?.kind === 'tag' ? tagNameKey(tag.name) : '';
  if (!key) return [];
  return (nodes || []).filter(node => node.kind === 'tag' && node !== tag &&
    (tag.id == null || node.id !== tag.id) && tagNameKey(node.name) === key);
}

export function nextTagName(nodes) {
  const names = new Set((nodes || []).filter(node => node.kind === 'tag').map(node => tagNameKey(node.name)));
  let index = 1;
  while (names.has(`net${index}`)) index++;
  return `NET${index}`;
}

function dimension(value, fallback, min, max) {
  const numeric = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, Math.round(numeric))) : fallback;
}

export const deviceWidth = node => dimension(node?.width, DEVICE_WIDTH, DEVICE_MIN_WIDTH, DEVICE_MAX_WIDTH);
export const deviceHeight = node => dimension(node?.height, DEVICE_HEIGHT, deviceMinHeight(node), DEVICE_MAX_HEIGHT);
export const tagWidth = node => dimension(node?.width, TAG_WIDTH, TAG_MIN_WIDTH, TAG_MAX_WIDTH);
export const tagHeight = node => dimension(node?.height, TAG_HEIGHT, TAG_MIN_HEIGHT, TAG_MAX_HEIGHT);
export function devicePortY(node, index) {
  const count = Number(node?.wireCount) === 4 ? 4 : 2;
  const height = deviceHeight(node);
  const inset = Math.max(10, Math.min(20, (height - (count - 1) * 20) / 2));
  return inset + index * (height - 2 * inset) / (count - 1);
}
export function applyCompactLabelSize(project) {
  if (project.labelSizeRevision === '210x60-v1') return false;
  for (const node of project.nodes) if (node.kind === 'device') {
    node.width = DEVICE_WIDTH;
    node.height = DEVICE_HEIGHT;
  }
  project.labelSizeRevision = '210x60-v1';
  return true;
}
export const clone = value => JSON.parse(JSON.stringify(value));
export const escapeXML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export const safeColor = (value, fallback = '#202631') => /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : fallback;

// Upgrade the old third/fourth conductor colors without moving their physical
// terminals, module connections, or saved route geometry. Custom colors stay
// with the same physical conductor; only its previous default is replaced.
export function applyFourWireOrder(project) {
  if (project.fourWireOrderRevision === FOUR_WIRE_ORDER_REVISION) return false;
  const replacements = {
    green: { key: 'white', previous: '#2b9b68', color: '#ffffff' },
    white: { key: 'green', previous: '#ffffff', color: '#2b9b68' },
  };
  const updatedColor = (value, replacement) => {
    const color = safeColor(value, replacement.previous);
    return color.toLowerCase() === replacement.previous ? replacement.color : color;
  };
  const fourWireIds = new Set();
  for (const node of project.nodes) {
    if (node.kind !== 'device' || Number(node.wireCount) !== 4) continue;
    fourWireIds.add(node.id);
    const previous = node.colors || {};
    node.colors = {
      ...previous,
      white: updatedColor(previous.green, replacements.green),
      green: updatedColor(previous.white, replacements.white),
    };
  }
  // normalizeProject has already oriented imported wires device -> module/tag.
  for (const wire of project.wires) {
    const [nodeId, key] = wire.from.split(':');
    const replacement = replacements[key];
    if (!fourWireIds.has(nodeId) || !replacement) continue;
    wire.from = `${nodeId}:${replacement.key}`;
    wire.color = updatedColor(wire.color, replacement);
  }
  project.fourWireOrderRevision = FOUR_WIRE_ORDER_REVISION;
  return true;
}

export const snap = (value, grid = 10) => Math.round(value / grid) * grid;
export const makeId = (prefix = 'n') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Row names are display metadata; connector IDs and wire anchors never change. */
export function terminalRowName(node, side) {
  const bottom = side === 'bottom';
  const value = String(node?.[bottom ? 'bottomRowName' : 'topRowName'] ?? '').trim().slice(0, 24).trim();
  return value || (bottom ? 'TB11' : 'TB10');
}

export function modulePortLabel(node, port) {
  return node?.type === 'DIN_RESISTOR' && ['top', 'bottom'].includes(port.side)
    ? `${terminalRowName(node, port.side)}.${port.channel + 1}`
    : port.label;
}

/** Tags and terminal blocks can join hardware without enabling arbitrary I/O-to-I/O wiring. */
export function compatiblePorts(a, b) {
  if (!a || !b || a.id === b.id || (a.nodeId && a.nodeId === b.nodeId)) return false;
  if (!['device', 'module', 'tag'].includes(a.kind) || !['device', 'module', 'tag'].includes(b.kind)) return false;
  if (a.kind === 'tag' || b.kind === 'tag') return a.kind !== b.kind;
  if (a.kind !== b.kind) return true;
  return a.kind === 'module' && (a.connectorRole === 'terminal' || b.connectorRole === 'terminal');
}

export function geometry(nodes, types) {
  const ports = Object.create(null), obstacles = [];
  for (const node of nodes) {
    if (node.kind === 'module') {
      const type = types[node.type];
      if (!type) continue;
      if (type.routingObstacles) {
        // A detached title is an ordinary routing obstruction, not part of the
        // port owner's escape exception. Wires must route around that title.
        type.routingObstacles.forEach((r, index) => {
          const id = index || r.avoidPortEscape ? `${node.id}-obstacle-${index}` : node.id;
          obstacles.push({
            id, nodeId: r.avoidPortEscape ? id : node.id,
            x: node.x + r.x, y: node.y + r.y, width: r.width, height: r.height,
          });
        });
      } else {
        const leftEdge = Math.min(...type.ports.map(port => port.x));
        const rightEdge = Math.max(...type.ports.map(port => port.x));
        const header = type.header || { x: 0, y: -36, width: type.width, height: 36 };
        obstacles.push(
          { id: `${node.id}-header`, nodeId: node.id, x: node.x + header.x, y: node.y + header.y, width: header.width, height: header.height },
          { id: node.id, nodeId: node.id, x: node.x + leftEdge, y: node.y, width: rightEdge - leftEdge, height: type.height },
        );
      }
      for (const port of type.ports) {
        const id = `${node.id}:${port.id}`;
        const label = modulePortLabel(node, port);
        ports[id] = { ...port, id, label, localId: port.id, nodeId: node.id, kind: 'module', ...(type.connectorRole ? { connectorRole: type.connectorRole } : {}), x: node.x + port.x, y: node.y + port.y, name: `${node.name || type.label} · ${label}` };
      }
    } else if (node.kind === 'device') {
      const conductors = CONDUCTORS[node.wireCount] || CONDUCTORS[2];
      const width = deviceWidth(node), height = deviceHeight(node);
      const spacing = devicePortY(node, 1) - devicePortY(node, 0);
      const hitRadius = Math.min(13, Math.max(6, spacing / 2 - .5));
      obstacles.push({ id: node.id, nodeId: node.id, x: node.x, y: node.y, width, height });
      conductors.forEach((c, i) => {
        const id = `${node.id}:${c.key}`;
        ports[id] = { ...c, id, localId: c.key, nodeId: node.id, kind: 'device', side: node.wireSide === 'left' ? 'left' : 'right', x: node.x + (node.wireSide === 'left' ? 0 : width), y: node.y + devicePortY(node, i), hitRadius, name: `${node.name} · ${c.name}`, color: safeColor(node.colors?.[c.key], c.color) };
      });
    } else if (node.kind === 'tag') {
      const side = ['left', 'right', 'top', 'bottom'].includes(node.wireSide) ? node.wireSide : 'right';
      const id = `${node.id}:connector`;
      const width = tagWidth(node), height = tagHeight(node);
      const x = side === 'left' ? 0 : side === 'right' ? width : width / 2;
      const y = side === 'top' ? 0 : side === 'bottom' ? height : height / 2;
      obstacles.push({ id: node.id, nodeId: node.id, x: node.x, y: node.y, width, height });
      ports[id] = { id, localId: 'connector', nodeId: node.id, kind: 'tag', side,
        x: node.x + x, y: node.y + y, label: 'connector', name: `${tagName(node.name) || 'Unnamed tag'} · connector` };
    }
  }
  return { ports, obstacles };
}

export function normalizeProject(input, types) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.nodes) || !Array.isArray(input.wires)) throw new Error('This is not a Wirebench project file.');
  if (input.version !== 1) throw new Error('This project version is not supported.');
  if (input.nodes.length > 500 || input.wires.length > 2000) throw new Error('This file is too large. Use up to 500 items and 2,000 wires per project.');
  const ids = new Set();
  const str = (value, limit = 120) => String(value ?? '').slice(0, limit);
  const pos = n => Number.isFinite(Number(n)) ? Math.max(-10000, Math.min(20000, Number(n))) : 0;
  const nodes = input.nodes.map(raw => {
    if (!raw || !['module', 'device', 'tag'].includes(raw.kind)) throw new Error('The project contains an unsupported item.');
    const id = str(raw.id, 90);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error('The project contains invalid or duplicate item IDs.');
    ids.add(id);
    const n = { id, kind: raw.kind, x: pos(raw.x), y: pos(raw.y), name: str(raw.name) };
    if (n.kind === 'tag') {
      const size = {};
      if (raw.width != null && raw.width !== '') size.width = tagWidth(raw);
      if (raw.height != null && raw.height !== '') size.height = tagHeight(raw);
      return { ...n, name: tagName(raw.name), wireSide: ['left', 'right', 'top', 'bottom'].includes(raw.wireSide) ? raw.wireSide : 'right', ...size };
    }
    if (n.kind === 'module') {
      if (!types[raw.type]) throw new Error(`Unknown module type: ${str(raw.type, 24)}`);
      const scheduleId = typeof raw.scheduleId === 'string' && /^[a-zA-Z0-9_-]{1,90}$/.test(raw.scheduleId) ? { scheduleId: raw.scheduleId } : {};
      const rowNames = raw.type === 'DIN_RESISTOR' ? { topRowName: terminalRowName(raw, 'top'), bottomRowName: terminalRowName(raw, 'bottom') } : {};
      return { ...n, type: raw.type, slot: str(raw.slot, 40), rio: str(raw.rio, 40), ...scheduleId, ...rowNames };
    }
    const wireCount = Number(raw.wireCount) === 4 ? 4 : 2;
    const colors = {};
    for (const c of CONDUCTORS[wireCount]) colors[c.key] = safeColor(raw.colors?.[c.key], c.color);
    const size = {};
    // Absent dimensions use the current default without locking future edits.
    if (raw.width != null && raw.width !== '') size.width = deviceWidth(raw);
    if (raw.height != null && raw.height !== '') size.height = deviceHeight({ ...raw, wireCount });
    const assignment = raw.assignment && typeof raw.assignment === 'object' && /^[a-zA-Z0-9_-]{1,90}$/.test(raw.assignment.moduleId || '') && Number.isInteger(raw.assignment.channel) && raw.assignment.channel >= 0 && raw.assignment.channel < 128
      ? { assignment: { moduleId: str(raw.assignment.moduleId, 90), channel: raw.assignment.channel, tag: str(raw.assignment.tag), statusTag: str(raw.assignment.statusTag), pinType: str(raw.assignment.pinType, 16) } } : {};
    return { ...n, cable: str(raw.cable, 36), wireCount, cableSide: raw.cableSide === 'right' ? 'right' : 'left', wireSide: raw.wireSide === 'left' ? 'left' : 'right', colors, ...size, ...assignment };
  });
  const moduleIds = new Set(nodes.filter(n => n.kind === 'module').map(n => n.id));
  for (const n of nodes) if (n.assignment && !moduleIds.has(n.assignment.moduleId)) delete n.assignment;
  const { ports } = geometry(nodes, types);
  const wireIds = new Set(), usedPorts = new Set();
  const wires = input.wires.map(raw => {
    const id = str(raw.id, 90);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || wireIds.has(id)) throw new Error('The project contains invalid or duplicate wire IDs.');
    wireIds.add(id);
    let from = ports[raw.from], to = ports[raw.to];
    if (!Object.hasOwn(ports, raw.from) || !Object.hasOwn(ports, raw.to) || !compatiblePorts(from, to)) throw new Error('A wire refers to a missing or incompatible terminal.');
    const reversed = from.kind !== 'device' && to.kind === 'device';
    if (reversed) [from, to] = [to, from];
    for (const port of [from, to]) {
      if (usedPorts.has(port.id) && (port.kind === 'device' || (!port.allowMultiple && !port.common))) {
        throw new Error(port.kind === 'device' ? 'A conductor is connected more than once.' : port.kind === 'tag' ? 'A connector tag is connected more than once.' : 'A channel terminal is connected more than once.');
      }
      usedPorts.add(port.id);
    }
    const routeGeometry = {};
    for (const key of ['manual', 'savedRoute']) {
      let routeInput = raw[key];
      if (reversed && routeInput && typeof routeInput === 'object' && Array.isArray(routeInput.points)) {
        routeInput = { ...routeInput, points: routeInput.points.slice().reverse(), from: routeInput.to, to: routeInput.from };
      }
      const route = normalizeManualRoute(routeInput);
      if (route) routeGeometry[key] = route;
    }
    return { id, from: from.id, to: to.id, color: safeColor(raw.color, from.color), width: Math.max(1, Math.min(8, Number(raw.width) || 2.5)), ...routeGeometry };
  });
  const settings = { grid: [5, 10, 20].includes(Number(input.settings?.grid)) ? Number(input.settings.grid) : 10, snap: input.settings?.snap !== false, defaultWidth: Math.max(1, Math.min(8, Number(input.settings?.defaultWidth) || 2.5)), autoRoute: input.settings?.autoRoute === true };
  const project = { version: 1, title: str(input.title || 'Untitled wiring'), nodes, wires, settings, ...(input.sourceSchedule === 'rio-schedule-v1' ? { sourceSchedule: input.sourceSchedule } : {}), ...(input.labelSizeRevision === '210x60-v1' ? { labelSizeRevision: input.labelSizeRevision } : {}), ...(input.fourWireOrderRevision === FOUR_WIRE_ORDER_REVISION ? { fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION } : {}) };
  applyFourWireOrder(project);
  return project;
}

export function boundsOf(nodes, types, routes = {}) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const n of nodes) {
    const t = n.kind === 'module' ? types[n.type] : null;
    if (t) {
      const header = t.header || { x: 0, y: -34, width: t.width, height: 32 };
      include(n.x + Math.min(-9, header.x - 9), n.y + Math.min(-9, header.y - 8));
      include(n.x + Math.max(t.width + 9, header.x + header.width + 9), n.y + Math.max(t.height + 9, header.y + header.height + 8));
    } else {
      include(n.x - 9, n.y - 9);
      include(n.x + (n.kind === 'tag' ? tagWidth(n) : deviceWidth(n)) + 9, n.y + (n.kind === 'tag' ? tagHeight(n) : deviceHeight(n)) + 9);
    }
  }
  for (const r of Object.values(routes)) for (const p of r.points || []) include(p.x, p.y);
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 900, height: 600 };
  return { x: minX, y: minY, width: Math.max(100, maxX - minX), height: Math.max(100, maxY - minY) };
}
