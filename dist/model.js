import { normalizeManualRoute } from './manual-routing.js';

export const CONDUCTORS = {
  2: [{ key: 'black', name: 'Black', color: '#202631' }, { key: 'white', name: 'White', color: '#ffffff' }],
  4: [{ key: 'red', name: 'Red', color: '#e54b4b' }, { key: 'black', name: 'Black', color: '#202631' }, { key: 'green', name: 'Green', color: '#2b9b68' }, { key: 'white', name: 'White', color: '#ffffff' }]
};
export const DEVICE_WIDTH = 210;
export const DEVICE_HEIGHT = 60;
export const DEVICE_MIN_WIDTH = 160;
export const DEVICE_MAX_WIDTH = 1000;
export const DEVICE_MAX_HEIGHT = 600;
export const deviceMinHeight = () => 60;

function dimension(value, fallback, min, max) {
  const numeric = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, Math.round(numeric))) : fallback;
}

export const deviceWidth = node => dimension(node?.width, DEVICE_WIDTH, DEVICE_MIN_WIDTH, DEVICE_MAX_WIDTH);
export const deviceHeight = node => dimension(node?.height, DEVICE_HEIGHT, deviceMinHeight(node), DEVICE_MAX_HEIGHT);
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
export const snap = (value, grid = 10) => Math.round(value / grid) * grid;
export const makeId = (prefix = 'n') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function geometry(nodes, types) {
  const ports = Object.create(null), obstacles = [];
  for (const node of nodes) {
    if (node.kind === 'module') {
      const type = types[node.type];
      if (!type) continue;
      const leftEdge = Math.min(...type.ports.map(port => port.x));
      const rightEdge = Math.max(...type.ports.map(port => port.x));
      obstacles.push(
        { id: `${node.id}-header`, nodeId: node.id, x: node.x, y: node.y - 36, width: type.width, height: 36 },
        { id: node.id, nodeId: node.id, x: node.x + leftEdge, y: node.y, width: rightEdge - leftEdge, height: type.height },
      );
      for (const port of type.ports) {
        const id = `${node.id}:${port.id}`;
        ports[id] = { ...port, id, localId: port.id, nodeId: node.id, kind: 'module', x: node.x + port.x, y: node.y + port.y, name: `${node.name || type.label} · ${port.label}` };
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
    if (!raw || !['module', 'device'].includes(raw.kind)) throw new Error('The project contains an unsupported item.');
    const id = str(raw.id, 90);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error('The project contains invalid or duplicate item IDs.');
    ids.add(id);
    const n = { id, kind: raw.kind, x: pos(raw.x), y: pos(raw.y), name: str(raw.name) };
    if (n.kind === 'module') {
      if (!types[raw.type]) throw new Error(`Unknown module type: ${str(raw.type, 24)}`);
      const scheduleId = typeof raw.scheduleId === 'string' && /^[a-zA-Z0-9_-]{1,90}$/.test(raw.scheduleId) ? { scheduleId: raw.scheduleId } : {};
      return { ...n, type: raw.type, slot: str(raw.slot, 40), rio: str(raw.rio, 40), ...scheduleId };
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
  const wireIds = new Set(), usedDevicePorts = new Set(), usedModulePorts = new Set();
  const wires = input.wires.map(raw => {
    const id = str(raw.id, 90);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || wireIds.has(id)) throw new Error('The project contains invalid or duplicate wire IDs.');
    wireIds.add(id);
    let from = ports[raw.from], to = ports[raw.to];
    if (!Object.hasOwn(ports, raw.from) || !Object.hasOwn(ports, raw.to) || !from || !to || !['module', 'device'].includes(from.kind) || !['module', 'device'].includes(to.kind) || from.kind === to.kind) throw new Error('A wire refers to a missing or incompatible terminal.');
    const reversed = from.kind === 'module';
    if (reversed) [from, to] = [to, from];
    if (usedDevicePorts.has(from.id)) throw new Error('A conductor is connected more than once.');
    if (usedModulePorts.has(to.id) && !to.allowMultiple && !to.common) throw new Error('A channel terminal is connected more than once.');
    usedDevicePorts.add(from.id); usedModulePorts.add(to.id);
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
  return { version: 1, title: str(input.title || 'Untitled wiring'), nodes, wires, settings, ...(input.sourceSchedule === 'rio-schedule-v1' ? { sourceSchedule: input.sourceSchedule } : {}), ...(input.labelSizeRevision === '210x60-v1' ? { labelSizeRevision: input.labelSizeRevision } : {}) };
}

export function boundsOf(nodes, types, routes = {}) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const n of nodes) {
    const t = n.kind === 'module' ? types[n.type] : null;
    include(n.x - 9, n.y - (t ? 42 : 9));
    include(n.x + (t ? t.width : deviceWidth(n)) + 9, n.y + (t ? t.height : deviceHeight(n)) + 9);
  }
  for (const r of Object.values(routes)) for (const p of r.points || []) include(p.x, p.y);
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 900, height: 600 };
  return { x: minX, y: minY, width: Math.max(100, maxX - minX), height: Math.max(100, maxY - minY) };
}
