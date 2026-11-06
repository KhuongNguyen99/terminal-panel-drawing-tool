import { normalizeManualRoute } from './manual-routing.js';

export const CONDUCTORS = {
  2: [{ key: 'black', name: 'Black', color: '#202631' }, { key: 'white', name: 'White', color: '#ffffff' }],
  4: [{ key: 'red', name: 'Red', color: '#e54b4b' }, { key: 'black', name: 'Black', color: '#202631' }, { key: 'white', name: 'White', color: '#ffffff' }, { key: 'green', name: 'Green', color: '#2b9b68' }]
};
export const FOUR_WIRE_ORDER_REVISION = 'white-before-green-v1';
export const RTD_CHANNEL_LAYOUT_REVISION = 'interleaved-channels-v1';
export const DEVICE_WIDTH = 210;
export const DEVICE_HEIGHT = 60;
export const DEVICE_MIN_WIDTH = 1;
export const DEVICE_MAX_WIDTH = 1000;
export const DEVICE_MAX_HEIGHT = 600;
export const deviceMinHeight = () => 1;
export const TAG_WIDTH = 160;
export const TAG_HEIGHT = 40;
export const TAG_MIN_WIDTH = 1;
export const TAG_MAX_WIDTH = 1000;
export const TAG_MIN_HEIGHT = 1;
export const TAG_MAX_HEIGHT = 600;
export const MAX_PROJECT_NODES = 500;
export const MAX_PROJECT_WIRES = 2000;
export const POSITION_MIN = -10000;
export const POSITION_MAX = 20000;

export function canAddToProject(project, { nodes = 0, wires = 0 } = {}) {
  return Number.isInteger(nodes) && nodes >= 0 && Number.isInteger(wires) && wires >= 0 &&
    project.nodes.length + nodes <= MAX_PROJECT_NODES && project.wires.length + wires <= MAX_PROJECT_WIRES;
}

export const positionInBounds = (x, y) => [x, y].every(value =>
  typeof value === 'number' && Number.isFinite(value) && value >= POSITION_MIN && value <= POSITION_MAX);

export const clampPosition = value => Number.isFinite(Number(value))
  ? Math.max(POSITION_MIN, Math.min(POSITION_MAX, Number(value))) : 0;

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
function labelInteger(value, min, max) {
  const numeric = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
  return Number.isInteger(numeric) && numeric >= min && numeric <= max ? numeric : undefined;
}
export const labelFontSize = node => labelInteger(node?.fontSize, 6, 72);
export const labelTextWidthPercent = node => labelInteger(node?.textWidthPercent, 25, 200) ?? 100;
export const moduleTitleFontSize = node => labelInteger(node?.titleFontSize, 6, 72);
export function moduleHeader(node, type) {
  const base = type.header || { x: 0, y: -34, width: type.width, height: 32 };
  const fontSize = moduleTitleFontSize(node);
  if (fontSize === undefined) return base;
  const height = Math.max(base.height, Math.ceil(fontSize * 1.2 + 12));
  return { ...base, y: base.y + base.height - height, height };
}
export function devicePortY(node, index) {
  const count = Number(node?.wireCount) === 4 ? 4 : 2;
  const height = deviceHeight(node);
  const inset = height < DEVICE_HEIGHT ? height / 6 : Math.max(10, Math.min(20, (height - (count - 1) * 20) / 2));
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

function wireLabelComponents(project) {
  const labels = new Map(project.nodes.filter(node => node.kind === 'wire-label').map(node => [node.id, node]));
  const conductors = new Map();
  for (const node of project.nodes) if (node.kind === 'device') {
    for (const conductor of CONDUCTORS[node.wireCount] || CONDUCTORS[2]) {
      const id = `${node.id}:${conductor.key}`;
      conductors.set(id, { id, node, key: conductor.key, defaultColor: conductor.color });
    }
  }
  const labelForPort = id => {
    if (typeof id !== 'string') return null;
    const separator = id.indexOf(':'), side = id.slice(separator + 1);
    return separator > 0 && ['left', 'right'].includes(side) ? labels.get(id.slice(0, separator)) : null;
  };
  const adjacent = new Map([...labels.keys()].map(id => [id, []]));
  for (const wire of project.wires) {
    const from = labelForPort(wire.from), to = labelForPort(wire.to);
    if (from) adjacent.get(from.id).push(wire);
    if (to && to !== from) adjacent.get(to.id).push(wire);
  }
  const visited = new Set(), components = [], byWire = new Map();
  for (const label of labels.values()) {
    if (visited.has(label.id)) continue;
    const component = { labels: [], wires: [], conductors: [] }, queue = [label];
    const wires = new Set(), anchors = new Set();
    visited.add(label.id);
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index]; component.labels.push(current);
      for (const wire of adjacent.get(current.id)) {
        if (wires.has(wire.id)) continue;
        wires.add(wire.id); component.wires.push(wire); byWire.set(wire.id, component);
        for (const endpoint of [wire.from, wire.to]) {
          const next = labelForPort(endpoint);
          if (next && !visited.has(next.id)) { visited.add(next.id); queue.push(next); }
          const conductor = conductors.get(endpoint);
          if (conductor && !anchors.has(conductor.id)) { anchors.add(conductor.id); component.conductors.push(conductor); }
        }
      }
    }
    const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    component.labels.sort(byId); component.wires.sort(byId); component.conductors.sort(byId);
    components.push(component);
  }
  return { components, byWire, conductors };
}

const colorChanges = () => ({ changed: false, changedWires: [], changedLabels: [], changedConductors: [], conflicts: [] });
const conductorColor = conductor => safeColor(conductor.node.colors?.[conductor.key], conductor.defaultColor);
function recordColorChange(result, collection, id) {
  result.changed = true;
  if (!result[collection].includes(id)) result[collection].push(id);
}
function writeConductorColor(conductor, color, result) {
  if (conductorColor(conductor) === color) return;
  if (!conductor.node.colors || typeof conductor.node.colors !== 'object') conductor.node.colors = {};
  conductor.node.colors[conductor.key] = color;
  recordColorChange(result, 'changedConductors', conductor.id);
}
function writeWireColor(wire, color, result) {
  if (wire.color === color) return;
  wire.color = color; recordColorChange(result, 'changedWires', wire.id);
}
function writeComponentColor(component, color, result) {
  for (const conductor of component.conductors) writeConductorColor(conductor, color, result);
  for (const wire of component.wires) writeWireColor(wire, color, result);
  for (const label of component.labels) {
    if (label.color === color) continue;
    label.color = color; recordColorChange(result, 'changedLabels', label.id);
  }
}

/** Only wire labels join wire sections; modules, tags, and cable conductors stop traversal. */
export function synchronizeWireLabelColors(project, { preferredPortId } = {}) {
  const result = colorChanges();
  for (const component of wireLabelComponents(project).components) {
    const source = component.conductors.find(conductor => conductor.id === preferredPortId) || component.conductors[0];
    const colors = component.conductors.map(conductor => ({ portId: conductor.id, color: conductorColor(conductor) }));
    if (new Set(colors.map(entry => entry.color.toLowerCase())).size > 1) {
      result.conflicts.push({ wireIds: component.wires.map(wire => wire.id), labelIds: component.labels.map(label => label.id),
        sourcePortId: source.id, color: conductorColor(source), conductors: colors });
    }
    // A cable always supplies the color, even if the module-side section was
    // connected first. After disconnection, keep the remaining section color.
    const color = source ? conductorColor(source)
      : component.wires.map(wire => safeColor(wire.color, null)).find(Boolean)
        || component.labels.map(label => safeColor(label.color, null)).find(Boolean) || '#202631';
    if (!component.wires.length && component.labels.every(label => label.color == null)) continue;
    writeComponentColor(component, color, result);
  }
  return result;
}

/** A deliberate edit recolors the continuous labeled wire and its cable anchors. */
export function setConnectedWireColor(project, wireId, value) {
  const result = colorChanges(), wire = project.wires.find(candidate => candidate.id === wireId);
  if (!wire) return result;
  const color = safeColor(value, safeColor(wire.color)), component = wireLabelComponents(project).byWire.get(wireId);
  if (component) writeComponentColor(component, color, result);
  else writeWireColor(wire, color, result); // Preserve ordinary single-wire editing behavior.
  return result;
}

/** Edit one cable conductor without traversing the other conductors in that cable. */
export function setConductorColor(project, deviceId, conductorKey, value) {
  const result = colorChanges(), topology = wireLabelComponents(project);
  const portId = `${deviceId}:${conductorKey}`, conductor = topology.conductors.get(portId);
  if (!conductor) return result;
  const color = safeColor(value, conductorColor(conductor));
  writeConductorColor(conductor, color, result);
  const updated = new Set();
  for (const wire of project.wires) {
    if (wire.from !== portId && wire.to !== portId) continue;
    const component = topology.byWire.get(wire.id);
    if (!component) writeWireColor(wire, color, result);
    else if (!updated.has(component)) { updated.add(component); writeComponentColor(component, color, result); }
  }
  return result;
}

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
  // normalizeProject has already oriented imported wires with devices first.
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

/** Rebuild only paths attached to the RTD contacts that changed physical sides. */
export function applyRtdChannelLayout(project, types) {
  if (project.rtdChannelLayoutRevision === RTD_CHANNEL_LAYOUT_REVISION) return false;
  const rtdIds = new Set(project.nodes.filter(node => node.kind === 'module' && node.type === 'AI_RTD').map(node => node.id));
  if (rtdIds.size) {
    const { ports } = geometry(project.nodes, types);
    const movedContact = id => {
      const port = ports[id];
      return port?.kind === 'module' && rtdIds.has(port.nodeId) && (port.channel === 1 || port.channel === 2);
    };
    for (const wire of project.wires) if (movedContact(wire.from) || movedContact(wire.to)) {
      delete wire.manual;
      delete wire.savedRoute;
    }
  }
  project.rtdChannelLayoutRevision = RTD_CHANNEL_LAYOUT_REVISION;
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

/** Wire labels join physical sections without enabling arbitrary I/O-to-I/O wiring. */
export function compatiblePorts(a, b) {
  if (!a || !b || a.id === b.id || (a.nodeId && a.nodeId === b.nodeId)) return false;
  if (!['device', 'module', 'tag', 'wire-label'].includes(a.kind) || !['device', 'module', 'tag', 'wire-label'].includes(b.kind)) return false;
  if (a.kind === 'wire-label' || b.kind === 'wire-label') return true;
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
          if (r.avoidPortEscape && moduleTitleFontSize(node) !== undefined) r = { ...r, ...moduleHeader(node, type) };
          const id = index || r.avoidPortEscape ? `${node.id}-obstacle-${index}` : node.id;
          obstacles.push({
            id, nodeId: r.avoidPortEscape ? id : node.id,
            x: node.x + r.x, y: node.y + r.y, width: r.width, height: r.height,
          });
        });
      } else {
        const leftEdge = Math.min(...type.ports.map(port => port.x));
        const rightEdge = Math.max(...type.ports.map(port => port.x));
        const header = moduleTitleFontSize(node) === undefined
          ? type.header || { x: 0, y: -36, width: type.width, height: 36 } : moduleHeader(node, type);
        obstacles.push(
          { id: `${node.id}-header`, nodeId: node.id, x: node.x + header.x, y: node.y + header.y, width: header.width, height: header.height },
          { id: node.id, nodeId: node.id, x: node.x + leftEdge, y: node.y, width: rightEdge - leftEdge, height: type.height },
        );
      }
      for (const port of type.ports) {
        const id = `${node.id}:${port.id}`;
        const label = modulePortLabel(node, port);
        ports[id] = { ...port, id, label, localId: port.id, nodeId: node.id, kind: 'module', ...(type.connectorRole ? { connectorRole: type.connectorRole } : {}), x: node.x + port.x, y: node.y + port.y, name: `${node.name || type.label} · ${port.connectionLabel || label}` };
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
    } else if (node.kind === 'wire-label') {
      const width = deviceWidth(node), height = deviceHeight(node), color = safeColor(node.color);
      obstacles.push({ id: node.id, nodeId: node.id, x: node.x, y: node.y, width, height });
      for (const side of ['left', 'right']) {
        const id = `${node.id}:${side}`;
        ports[id] = { id, localId: side, nodeId: node.id, kind: 'wire-label', side, color,
          x: node.x + (side === 'left' ? 0 : width), y: node.y + height / 2,
          label: `${side === 'left' ? 'Left' : 'Right'} connector`, name: `${node.name || 'Wire label'} · ${side} connector` };
      }
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
  if (input.nodes.length > MAX_PROJECT_NODES || input.wires.length > MAX_PROJECT_WIRES) throw new Error('This file is too large. Use up to 500 items and 2,000 wires per project.');
  const ids = new Set();
  const str = (value, limit = 120) => String(value ?? '').slice(0, limit);
  const pos = clampPosition;
  const nodes = input.nodes.map(raw => {
    if (!raw || !['module', 'device', 'tag', 'wire-label'].includes(raw.kind)) throw new Error('The project contains an unsupported item.');
    const id = str(raw.id, 90);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error('The project contains invalid or duplicate item IDs.');
    ids.add(id);
    const n = { id, kind: raw.kind, x: pos(raw.x), y: pos(raw.y), name: str(raw.name) };
    const typography = {};
    if (raw.kind !== 'module') {
      const fontSize = labelFontSize(raw);
      if (fontSize !== undefined) typography.fontSize = fontSize;
      if (Object.hasOwn(raw, 'textWidthPercent')) typography.textWidthPercent = labelTextWidthPercent(raw);
    }
    if (n.kind === 'tag') {
      const size = {};
      if (raw.width != null && raw.width !== '') size.width = tagWidth(raw);
      if (raw.height != null && raw.height !== '') size.height = tagHeight(raw);
      return { ...n, name: tagName(raw.name), wireSide: ['left', 'right', 'top', 'bottom'].includes(raw.wireSide) ? raw.wireSide : 'right', ...size, ...typography };
    }
    if (n.kind === 'wire-label') {
      const appearance = {};
      if (raw.width != null && raw.width !== '') appearance.width = deviceWidth(raw);
      if (raw.height != null && raw.height !== '') appearance.height = deviceHeight(raw);
      if (raw.color != null && raw.color !== '') appearance.color = safeColor(raw.color);
      return { ...n, ...appearance, ...typography };
    }
    if (n.kind === 'module') {
      if (!types[raw.type]) throw new Error(`Unknown module type: ${str(raw.type, 24)}`);
      if (raw.type === 'DIN_TERMINAL' && n.name.trim().toLowerCase() === 'din rail terminal block') n.name = types[raw.type].label;
      const scheduleId = typeof raw.scheduleId === 'string' && /^[a-zA-Z0-9_-]{1,90}$/.test(raw.scheduleId) ? { scheduleId: raw.scheduleId } : {};
      const rowNames = raw.type === 'DIN_RESISTOR' ? { topRowName: terminalRowName(raw, 'top'), bottomRowName: terminalRowName(raw, 'bottom') } : {};
      const titleFontSize = moduleTitleFontSize(raw);
      const titleStyle = titleFontSize === undefined ? {} : { titleFontSize };
      return { ...n, type: raw.type, slot: str(raw.slot, 40), rio: str(raw.rio, 40), ...scheduleId, ...rowNames, ...titleStyle };
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
    return { ...n, cable: str(raw.cable, 36), wireCount, cableSide: raw.cableSide === 'right' ? 'right' : 'left', wireSide: raw.wireSide === 'left' ? 'left' : 'right', colors, ...size, ...typography, ...assignment };
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
        throw new Error(port.kind === 'device' ? 'A conductor is connected more than once.' : port.kind === 'tag' ? 'A connector tag is connected more than once.' : port.kind === 'wire-label' ? 'A wire label connector is connected more than once.' : 'A channel terminal is connected more than once.');
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
  const project = { version: 1, title: str(input.title || 'Untitled wiring'), nodes, wires, settings, ...(input.sourceSchedule === 'rio-schedule-v1' ? { sourceSchedule: input.sourceSchedule } : {}), ...(input.labelSizeRevision === '210x60-v1' ? { labelSizeRevision: input.labelSizeRevision } : {}), ...(input.fourWireOrderRevision === FOUR_WIRE_ORDER_REVISION ? { fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION } : {}), ...(input.rtdChannelLayoutRevision === RTD_CHANNEL_LAYOUT_REVISION ? { rtdChannelLayoutRevision: RTD_CHANNEL_LAYOUT_REVISION } : {}) };
  applyFourWireOrder(project);
  applyRtdChannelLayout(project, types);
  synchronizeWireLabelColors(project);
  return project;
}

export function boundsOf(nodes, types, routes = {}) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const include = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const n of nodes) {
    const t = n.kind === 'module' ? types[n.type] : null;
    if (t) {
      const header = moduleHeader(n, t);
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
