import { MODULE_TYPES } from './modules.js';
import { routeWithPreferences } from './independent-routing.js';
import { RIO_SCHEDULE, SCHEDULE_SUMMARY, createScheduleProject } from './schedule.js';
import { scheduleModuleIdForNode, focusNodesForModule } from './schedule-navigation.js';
import { captureManualRoute, moveWireSegment } from './manual-routing.js';
import { CONDUCTORS, FOUR_WIRE_ORDER_REVISION, DEVICE_MIN_WIDTH, DEVICE_MAX_WIDTH, DEVICE_MAX_HEIGHT, deviceMinHeight, deviceWidth, deviceHeight, devicePortY, applyCompactLabelSize, clone, escapeXML as esc, safeColor, snap, makeId, geometry, normalizeProject, boundsOf } from './model.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#canvas'), stage = $('#stage');
const scheduleWorkspace = new URLSearchParams(location.search).get('project') === 'rio-schedule';
const LOCAL_KEY = scheduleWorkspace ? 'wirebench-rio-schedule-v1' : 'wirebench-project-v1';
let project, selected = new Set(), selectedWire = null, tool = 'select', spaceDown = false;
let focusedModuleId = '';
let selectedSegmentIndex = null;
let renderingInspector = false;
let view = { x: 0, y: 0, zoom: .75 }, geo = { ports: {}, obstacles: [] }, routing = { routes: {}, diagnostics: {} };
let gesture = null, pendingPort = null, pointer = null, snapTarget = null, routeFrame = 0, autosaveTimer = 0;
let undoStack = [], redoStack = [], toastTimer = 0, fitOnce = true, exportEpoch = 0, textEdit = null;
const imageCache = new Map();

function newDevice(wireCount = 2, extra = {}) {
  return { id: makeId('dev'), kind: 'device', name: 'New device', cable: '', wireCount, x: 40, y: 250, cableSide: 'left', wireSide: 'right', colors: {}, ...extra };
}
function newModule(type = 'AI', extra = {}) {
  return { id: makeId('mod'), kind: 'module', type, name: MODULE_TYPES[type]?.label || type, rio: 'RIO A', slot: '', x: 430, y: 90, ...extra };
}
function exampleProject(full = false) {
  const m = newModule('AI', { id: 'module-slot5', name: 'Analog input', slot: '5', x: 440, y: 80 });
  const mapping = [ ['17', '*v-3501#-y-pos'], ['23', '*v-3511#-y-pos'], ['13', '*v-3531#-pos'], ['21', '*v-3541#-pos'], ['19', '*v-3541#-y-pos'], ['9', '*v-3551#-pos'], ['7', '*v-3561#-pos'], ['26', '*v-3571#1-pos'] ];
  const nodes = [m], wires = [];
  mapping.slice(0, full ? 8 : 2).forEach(([cable, name], ch) => {
    const side = ch % 2 ? 'right' : 'left';
    const d = newDevice(2, { id: `device-ch${ch}`, name, cable, x: side === 'left' ? 20 : 980, y: full ? 150 + Math.floor(ch / 2) * 170 : (ch ? 310 : 230), cableSide: side, wireSide: side === 'left' ? 'right' : 'left' });
    nodes.push(d);
    for (const [key, signal] of [['black', '-'], ['white', '+']]) {
      const port = MODULE_TYPES.AI.ports.find(p => Number(p.channel) === ch && (p.signal === signal || p.label.replace(/\s/g, '').endsWith(`${ch}${signal}`)));
      if (port) wires.push({ id: `wire-${ch}-${key}`, from: `${d.id}:${key}`, to: `${m.id}:${port.id}`, color: CONDUCTORS[2].find(c => c.key === key).color, width: 2.5 });
    }
  });
  return { version: 1, title: full ? 'RIO A · Slot 5' : 'My wiring project', nodes, wires, settings: { grid: 10, snap: true, defaultWidth: 2.5, autoRoute: false }, labelSizeRevision: '210x60-v1', fourWireOrderRevision: FOUR_WIRE_ORDER_REVISION };
}

try {
  const saved = localStorage.getItem(LOCAL_KEY);
  project = saved ? normalizeProject(JSON.parse(saved), MODULE_TYPES) : createScheduleProject();
} catch { project = createScheduleProject(); }
const labelsResized = applyCompactLabelSize(project);

function notify(message, error = false) {
  const t = $('#toast'); t.textContent = message; t.classList.toggle('is-error', error); t.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('visible'), error ? 6500 : 3500);
  $('#status-message').textContent = message;
}
function saveLocal() {
  clearTimeout(autosaveTimer);
  $('#save-status').textContent = 'Saving…';
  autosaveTimer = setTimeout(() => {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(project)); $('#save-status').textContent = 'Saved in this browser'; }
    catch { $('#save-status').textContent = 'Save a project file to keep changes'; }
  }, 220);
}
function remember(before) {
  const previous = before || clone(project);
  undoStack.push(previous); if (undoStack.length > 80) undoStack.shift(); redoStack = [];
}
function commitTextEdit() {
  if (!textEdit) return;
  const edit = textEdit; textEdit = null;
  if (JSON.stringify(edit.before) !== JSON.stringify(project)) { remember(edit.before); syncControls(); }
}
function change(callback, message, routeOptions = true) {
  commitTextEdit();
  const before = clone(project); callback();
  if (JSON.stringify(before) === JSON.stringify(project)) return;
  remember(before); render(routeOptions); saveLocal(); if (message) notify(message);
}
function undo() {
  commitTextEdit();
  if (!undoStack.length) return;
  redoStack.push(clone(project)); project = undoStack.pop(); clearSelection(); render({ preserveRoutes: true }); saveLocal(); notify('Change undone');
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(clone(project)); project = redoStack.pop(); clearSelection(); render({ preserveRoutes: true }); saveLocal(); notify('Change restored');
}
function clearSelection() { selected.clear(); selectedWire = null; selectedSegmentIndex = null; pendingPort = null; snapTarget = null; }
function nodeById(id) { return project.nodes.find(n => n.id === id); }
function selectedNode() { return selected.size === 1 ? nodeById([...selected][0]) : null; }
function occupied(id, ignoreWire) { return project.wires.find(w => w.id !== ignoreWire && (w.from === id || w.to === id)); }
function world(event) { const r = canvas.getBoundingClientRect(); return { x: view.x + (event.clientX - r.left) / view.zoom, y: view.y + (event.clientY - r.top) / view.zoom }; }
function snapped(value) { return project.settings.snap ? snap(value, project.settings.grid) : Math.round(value); }
function viewportCenter() { return { x: view.x + stage.clientWidth / (2 * view.zoom), y: view.y + stage.clientHeight / (2 * view.zoom) }; }

function syncView() {
  const w = Math.max(1, stage.clientWidth), h = Math.max(1, stage.clientHeight);
  canvas.setAttribute('viewBox', `${view.x} ${view.y} ${w / view.zoom} ${h / view.zoom}`);
  $('#zoom-label').textContent = `${Math.round(view.zoom * 100)}%`;
  const bg = $('#grid-background');
  if (bg) { bg.setAttribute('x', view.x); bg.setAttribute('y', view.y); bg.setAttribute('width', w / view.zoom); bg.setAttribute('height', h / view.zoom); }
}
function fitBoard() {
  const b = boundsOf(project.nodes, MODULE_TYPES, routing.routes);
  const w = stage.clientWidth, h = stage.clientHeight;
  view.zoom = Math.max(.04, Math.min(1.3, w / (b.width + 130), h / (b.height + 130)));
  view.x = b.x + b.width / 2 - w / view.zoom / 2;
  view.y = b.y + b.height / 2 - h / view.zoom / 2;
  syncView();
}
function zoomBy(factor, client) {
  const rect = canvas.getBoundingClientRect();
  const cx = client ? client.x - rect.left : rect.width / 2, cy = client ? client.y - rect.top : rect.height / 2;
  const wx = view.x + cx / view.zoom, wy = view.y + cy / view.zoom;
  view.zoom = Math.max(.04, Math.min(2.5, view.zoom * factor));
  view.x = wx - cx / view.zoom; view.y = wy - cy / view.zoom; syncView();
}

function routesForNodes(nodes) {
  const ids = new Set(nodes.map(n => n.id)), routes = {};
  for (const w of project.wires) if (ids.has(w.from.split(':')[0]) && ids.has(w.to.split(':')[0]) && routing.routes[w.id]) routes[w.id] = routing.routes[w.id];
  return routes;
}
function focusModule(moduleId, select = true) {
  const nodes = focusNodesForModule(moduleId, project);
  if (!nodes.length) { focusedModuleId = ''; if (select) { clearSelection(); render(false); } fitBoard(); return; }
  focusedModuleId = moduleId;
  if (select) { selected = new Set([moduleId]); selectedWire = null; pendingPort = null; render(false); }
  const b = boundsOf(nodes, MODULE_TYPES, routesForNodes(nodes));
  view.zoom = Math.max(.04, Math.min(1.3, stage.clientWidth / (b.width + 100), stage.clientHeight / (b.height + 130)));
  view.x = b.x + b.width / 2 - stage.clientWidth / view.zoom / 2;
  view.y = b.y + b.height / 2 - stage.clientHeight / view.zoom / 2;
  syncView(); renderNavigation(); renderDeviceList();
}
function initialView() {
  if (project.sourceSchedule === 'rio-schedule-v1') focusModule(project.nodes.some(n => n.id === 'rioa-slot5') ? 'rioa-slot5' : project.nodes.find(n => n.kind === 'module')?.id, true);
  else fitBoard();
}
function renderNavigation() {
  const modules = project.nodes.filter(n => n.kind === 'module');
  const selectedModuleId = scheduleModuleIdForNode(selectedNode(), project);
  if (selectedModuleId) focusedModuleId = selectedModuleId;
  if (!modules.some(n => n.id === focusedModuleId)) focusedModuleId = '';
  const select = $('#slot-jump');
  select.innerHTML = '<option value="">All slots · overview</option>' + modules.map(n => `<option value="${esc(n.id)}">${esc([n.rio, n.slot !== '' ? `Slot ${n.slot}` : n.name, MODULE_TYPES[n.type].label].filter(Boolean).join(' · '))}</option>`).join('');
  select.value = focusedModuleId;
  $('#slot-summary').textContent = project.sourceSchedule === 'rio-schedule-v1' ? `${SCHEDULE_SUMMARY.slots} slots · ${SCHEDULE_SUMMARY.channels} source channels · ${SCHEDULE_SUMMARY.assigned} assigned · ${SCHEDULE_SUMMARY.spare} spare` : `${modules.length} module${modules.length === 1 ? '' : 's'} · editable diagram`;
  $('#device-list-scope').textContent = focusedModuleId ? 'Current slot' : 'All devices';
}

function setupGrid() {
  const ns = 'http://www.w3.org/2000/svg';
  if (!$('#grid-defs')) {
    const defs = document.createElementNS(ns, 'defs'); defs.id = 'grid-defs';
    defs.innerHTML = '<pattern id="dot-grid" patternUnits="userSpaceOnUse" width="10" height="10"><circle cx="0" cy="0" r=".9" fill="#c7d2d9"/></pattern>';
    canvas.prepend(defs);
    const bg = document.createElementNS(ns, 'rect'); bg.id = 'grid-background'; bg.setAttribute('fill', 'url(#dot-grid)'); canvas.insertBefore(bg, defs.nextSibling);
  }
  $('#dot-grid').setAttribute('width', project.settings.grid); $('#dot-grid').setAttribute('height', project.settings.grid);
  $('#dot-grid').setAttribute('x', -project.settings.grid / 2); $('#dot-grid').setAttribute('y', -project.settings.grid / 2);
  $('#dot-grid circle').setAttribute('cx', project.settings.grid / 2); $('#dot-grid circle').setAttribute('cy', project.settings.grid / 2);
}

function portMarkup(p, localX, localY, exporting = false) {
  if (exporting) return '';
  const connected = !!occupied(p.id);
  const fill = p.kind === 'device' ? p.color : '#ffffff';
  return `<g class="port ${connected ? 'is-connected' : ''} ${pendingPort === p.id ? 'is-start' : ''}" data-port="${esc(p.id)}" role="button" aria-label="${esc(p.name)}" tabindex="0" transform="translate(${localX} ${localY})"><title>${esc(p.name)}${connected ? ' · connected' : ' · click or drag to connect'}</title><circle class="port-hit" r="${p.hitRadius || 13}" fill="transparent"/><circle class="port-dot" r="${p.kind === 'device' ? 5.5 : 4}" fill="${fill}" stroke="${connected ? '#0b9186' : (p.kind === 'device' && p.color.toLowerCase() === '#ffffff' ? '#8996a4' : '#64788a')}" stroke-width="1.6"/></g>`;
}

const portLabelMeasure = document.createElement('canvas').getContext('2d');
portLabelMeasure.font = '14px Arial';

function moduleMarkup(n, exporting = false, embedded = {}) {
  const t = MODULE_TYPES[n.type], b = t.body;
  const instance = [n.rio, n.slot !== '' ? `Slot ${n.slot}` : ''].filter(Boolean).join(' · ');
  const selectedClass = !exporting && selected.has(n.id) ? 'is-selected' : '';
  let out = `<g class="module-node ${selectedClass}" ${exporting ? '' : `data-node="${esc(n.id)}"`} transform="translate(${n.x} ${n.y})">`;
  if (!exporting) out += `<rect class="selection-ring" x="-8" y="-42" width="${t.width + 16}" height="${t.height + 50}" rx="12" fill="none" stroke="#0d9488" stroke-width="1.5" stroke-dasharray="6 4" opacity="${selectedClass ? 1 : 0}" pointer-events="none"/>`;
  out += `<g class="module-header" ${exporting ? '' : 'data-drag-handle="true"'}><rect x="0" y="-34" width="${t.width}" height="32" rx="7" fill="#ffffff" stroke="#e2e8ed"/><rect x="10" y="-24" width="5" height="12" rx="2" fill="#0d9488"/><text x="24" y="-13" fill="#20303d" font-size="13" font-weight="700">${esc(n.name || t.label)}</text><text class="module-instance" x="${t.width - 10}" y="-13" text-anchor="end" fill="#20303d" font-size="16" font-weight="700">${esc(instance)}</text></g>`;
  out += `<image href="${esc(embedded[n.type] || t.image)}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" preserveAspectRatio="none" ${exporting ? '' : 'data-drag-handle="true"'} />`;
  for (const p of t.ports) {
    const left = p.side === 'left';
    const px = p.x + (left ? 13 : -13);
    const label = p.label;
    const y = p.y, targetX = left ? (b.terminalLeft ?? b.x) : (b.terminalRight ?? (b.x + b.w));
    const pinY = p.pinY ?? y;
    // Keep an eight-unit label-to-arrow gap on either side, including RTD labels.
    const labelWidth = portLabelMeasure.measureText(label).width;
    const lineStart = px + (left ? 1 : -1) * (labelWidth + 8);
    // Both the shaft and arrowhead aim at the center of the physical terminal.
    const dx = targetX - lineStart, dy = pinY - y, length = Math.hypot(dx, dy);
    const ux = dx / length, uy = dy / length;
    const baseX = targetX - ux * 10, baseY = pinY - uy * 10;
    if (p.accent) out += `<rect x="${left ? px - 5 : px - labelWidth - 5}" y="${y - 9}" width="${labelWidth + 10}" height="18" rx="3" fill="${esc(p.accent)}" fill-opacity=".15"/>`;
    out += `<text class="port-label" x="${px}" y="${y + 4}" text-anchor="${left ? 'start' : 'end'}" font-family="Arial, sans-serif" font-size="14" fill="#263947">${esc(label)}</text><path class="port-arrow" d="M${lineStart} ${y} L${baseX} ${baseY}" fill="none" stroke="#dc2626" stroke-width="3.5" stroke-linecap="round"/><path class="port-arrowhead" d="M${targetX} ${pinY} L${baseX - uy * 5} ${baseY + ux * 5} L${baseX + uy * 5} ${baseY - ux * 5} Z" fill="#dc2626"/>`;
    out += portMarkup(geo.ports[`${n.id}:${p.id}`] || { ...p, id: `${n.id}:${p.id}`, kind: 'module' }, p.x, p.y, exporting);
  }
  out += '</g>'; return out;
}
const deviceTextMeasure = document.createElement('canvas').getContext('2d');
function deviceNameLayout(name, width, height) {
  const availableWidth = width - 82, availableHeight = height - 34;
  let lines = [], fontSize = 15, lineHeight = 18, maxLines = 1;
  for (; fontSize >= 10; fontSize--) {
    deviceTextMeasure.font = `700 ${fontSize}px Arial`;
    lineHeight = fontSize + 3;
    maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
    lines = []; let rest = name;
    while (rest.length) {
      let count = 1;
      while (count < rest.length && deviceTextMeasure.measureText(rest.slice(0, count + 1)).width <= availableWidth) count++;
      const space = rest.lastIndexOf(' ', count);
      if (count < rest.length && space > count / 2) count = space;
      lines.push(rest.slice(0, count)); rest = rest.slice(count).trimStart();
    }
    if (lines.length <= maxLines) break;
  }
  if (fontSize < 10) {
    fontSize = 10; lineHeight = 13;
    maxLines = Math.max(1, Math.floor(availableHeight / lineHeight));
    const chunk = Math.ceil(name.length / maxLines);
    lines = Array.from({ length: Math.ceil(name.length / chunk) }, (_, i) => name.slice(i * chunk, (i + 1) * chunk));
  }
  deviceTextMeasure.font = `700 ${fontSize}px Arial`;
  return { lines, fontSize, lineHeight, availableWidth,
    startY: 10 + availableHeight / 2 - (lines.length - 1) * lineHeight / 2 + fontSize * .35 };
}
function deviceResizeMarkup(n, w, h) {
  const handles = [
    { axis: 'e', x: w + 12, y: h / 2, label: 'Resize label width' },
    { axis: 's', x: w / 2, y: h + 10, label: 'Resize label height' },
    { axis: 'se', x: w + 7, y: h + 7, label: 'Resize label width and height' },
  ];
  return handles.map(handle => `<g class="device-resize" data-resize="${handle.axis}" role="button" tabindex="0" aria-label="${handle.label}" transform="translate(${handle.x} ${handle.y})"><title>${handle.label} · drag, or use arrow keys</title><rect class="resize-hit" x="-7" y="-7" width="14" height="14" fill="transparent"/><rect class="resize-grip" x="-4" y="-4" width="8" height="8" rx="1.5" fill="#ffffff" stroke="#0d9488" stroke-width="1.5"/></g>`).join('');
}
function deviceMarkup(n, exporting = false) {
  const h = deviceHeight(n), w = deviceWidth(n), rightCable = n.cableSide === 'right', badgeX = rightCable ? w - 58 : 0;
  const textCenter = rightCable ? (w - 58) / 2 : 58 + (w - 58) / 2;
  const { lines, fontSize, lineHeight, startY, availableWidth } = deviceNameLayout(n.name || 'Unnamed device', w, h);
  let out = `<g class="device-node ${!exporting && selected.has(n.id) ? 'is-selected' : ''}" ${exporting ? '' : `data-node="${esc(n.id)}" data-drag-handle="true"`} transform="translate(${n.x} ${n.y})">`;
  if (!exporting && selected.has(n.id)) out += `<rect x="-6" y="-6" width="${w + 12}" height="${h + 12}" rx="11" fill="none" stroke="#0d9488" stroke-width="1.5" stroke-dasharray="6 4" pointer-events="none"/>`;
  out += `<rect class="device-box" width="${w}" height="${h}" rx="5" fill="#ffffff" stroke="#566775" stroke-width="1.3"/><path d="M${rightCable ? w - 58 : 58} 0 V${h}" stroke="#d8e1e7"/><rect x="${badgeX + 1}" y="1" width="56" height="${h - 2}" rx="4" fill="#eef5f7"/><text x="${badgeX + 29}" y="${h / 2 - 10}" text-anchor="middle" font-size="8" letter-spacing="1" font-weight="700" fill="#6a8190">CABLE</text><text class="cable-label" x="${badgeX + 29}" y="${h / 2 + 15}" text-anchor="middle" fill="#186783" font-weight="700" font-size="${String(n.cable).length > 4 ? 13 : 23}" ${String(n.cable).length > 5 ? 'textLength="43" lengthAdjust="spacingAndGlyphs"' : ''}>${esc(n.cable || '—')}</text>`;
  lines.forEach((line, i) => { out += `<text class="device-title" x="${textCenter}" y="${startY + i * lineHeight}" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="${fontSize}" ${deviceTextMeasure.measureText(line).width > availableWidth ? `textLength="${availableWidth}" lengthAdjust="spacingAndGlyphs"` : ''} fill="#20303d">${esc(line)}</text>`; });
  out += `<text x="${textCenter}" y="${h - 11}" text-anchor="middle" font-size="9" fill="#728491">${n.wireCount}-wire cable</text>`;
  const c = CONDUCTORS[n.wireCount] || CONDUCTORS[2];
  c.forEach((conductor, i) => {
    const x = n.wireSide === 'left' ? 0 : w, y = devicePortY(n, i), p = geo.ports[`${n.id}:${conductor.key}`];
    if (exporting) out += `<circle cx="${x}" cy="${y}" r="2.5" fill="${safeColor(n.colors?.[conductor.key], conductor.color)}" stroke="${conductor.key === 'white' ? '#8b9ba8' : 'none'}" stroke-width="1"/>`;
    else out += portMarkup(p, x, y);
  });
  if (!exporting && selected.has(n.id) && selected.size === 1) out += deviceResizeMarkup(n, w, h);
  return out + '</g>';
}

function routePath(points, crossings = []) {
  if (!points?.length) return '';
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], horizontal = Math.abs(a.y - b.y) < .01, vertical = Math.abs(a.x - b.x) < .01;
    const length = Math.hypot(b.x - a.x, b.y - a.y), dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
    const cross = (horizontal || vertical) ? crossings.filter(p => (horizontal ? Math.abs(p.y - a.y) < .5 && p.x > Math.min(a.x, b.x) && p.x < Math.max(a.x, b.x) : Math.abs(p.x - a.x) < .5 && p.y > Math.min(a.y, b.y) && p.y < Math.max(a.y, b.y)) && Math.hypot(p.x - a.x, p.y - a.y) > 9 && Math.hypot(p.x - b.x, p.y - b.y) > 9 && Math.hypot(p.x - a.x, p.y - a.y) < length).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y)) : [];
    let previous = -Infinity;
    for (const p of cross) {
      const dist = Math.hypot(p.x - a.x, p.y - a.y); if (dist - previous < 15) continue; previous = dist;
      d += horizontal ? ` L${p.x - dx * 6} ${p.y} Q${p.x} ${p.y - 10} ${p.x + dx * 6} ${p.y}` : ` L${p.x} ${p.y - dy * 6} Q${p.x - 10} ${p.y} ${p.x} ${p.y + dy * 6}`;
    }
    d += ` L${b.x} ${b.y}`;
  }
  return d;
}
function wireSegments(points = []) {
  return points.slice(1).map((b, index) => {
    const a = points[index], horizontal = Math.abs(a.y - b.y) < .00001;
    return { index, a, b, horizontal, coordinate: horizontal ? a.y : a.x, midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  });
}
function nearestWireSegment(points, pos, horizontal = null) {
  let best = null, distance = Infinity;
  const parallel = wireSegments(points).filter(s => horizontal === null || s.horizontal === horizontal);
  const onMovedLine = horizontal === null ? [] : parallel.filter(s => Math.abs(s.coordinate - (horizontal ? pos.y : pos.x)) < .00001);
  for (const s of onMovedLine.length ? onMovedLine : parallel) {
    const x = s.horizontal ? Math.max(Math.min(s.a.x, s.b.x), Math.min(Math.max(s.a.x, s.b.x), pos.x)) : s.a.x;
    const y = s.horizontal ? s.a.y : Math.max(Math.min(s.a.y, s.b.y), Math.min(Math.max(s.a.y, s.b.y), pos.y));
    const d = Math.hypot(pos.x - x, pos.y - y);
    if (d < distance) { best = s.index; distance = d; }
  }
  return best;
}
function editPort(p) {
  if (!p) return null;
  const grid = project.settings.grid, gap = Math.max(10, grid);
  const widest = project.wires.reduce((m, w) => Math.max(m, Number(w.width) || 2), 2);
  const padding = Math.max(gap / 2, widest / 2 + 2), left = p.side === 'left';
  const owners = geo.obstacles.filter(r => r.nodeId === p.nodeId);
  const boundary = owners.length ? (left ? Math.min(p.x, ...owners.map(r => r.x - padding)) : Math.max(p.x, ...owners.map(r => r.x + r.width + padding))) : p.x + (left ? -grid / 2 : grid / 2);
  return { ...p, escapeX: (left ? Math.floor((boundary - .000001) / grid) : Math.ceil((boundary + .000001) / grid)) * grid };
}
function segmentOptions(w) {
  return { grid: project.settings.grid, snap: project.settings.snap, gap: Math.max(10, project.settings.grid), from: editPort(geo.ports[w.from]), to: editPort(geo.ports[w.to]) };
}
function commitWireSegment(wireId, points, before = clone(project), movedAt = null) {
  const w = project.wires.find(wire => wire.id === wireId), route = routing.routes[wireId];
  if (!w || !points) { render(false); notify('This segment cannot move to that position. Try another grid line.', true); return false; }
  if (JSON.stringify(points) === JSON.stringify(route?.points)) { render(false); return false; }
  const previousBlocked = new Set(Object.entries(routing.routes).filter(([, r]) => r.status === 'blocked').map(([id]) => id));
  const manual = captureManualRoute(points, geo.ports[w.from], geo.ports[w.to]);
  if (!manual) { render(false); notify('Keep the wire horizontal and vertical, with both ends connected.', true); return false; }
  w.manual = manual;
  computeRoutes({ preserveRoutes: true });
  const blocked = Object.entries(routing.routes).find(([id, r]) => r.status === 'blocked' && (id === wireId || !previousBlocked.has(id)));
  const incomplete = project.wires.some(wire => !routing.routes[wire.id]);
  if (blocked || incomplete) {
    const reason = blocked?.[1].diagnostics?.[0] || 'No clear routing lane is available.';
    project = before; render({ preserveRoutes: true }); notify(`Segment not moved. ${reason}`, true); return false;
  }
  if (movedAt) selectedSegmentIndex = nearestWireSegment(routing.routes[wireId].points, movedAt, movedAt.horizontal ?? null);
  remember(before); render(false); saveLocal(); notify('Wire segment moved · other wires kept in place'); return true;
}
function moveSelectedSegment(coordinate) {
  const w = project.wires.find(wire => wire.id === selectedWire), route = routing.routes[selectedWire];
  if (!w || !route?.points?.length || !Number.isFinite(Number(coordinate))) return;
  commitTextEdit();
  const s = wireSegments(route.points)[selectedSegmentIndex ?? 0]; if (!s) return;
  const points = moveWireSegment(route.points, s.index, Number(coordinate), segmentOptions(w));
  const movedAt = { ...s.midpoint, horizontal: s.horizontal, [s.horizontal ? 'y' : 'x']: snapped(Number(coordinate)) };
  commitWireSegment(w.id, points, clone(project), movedAt);
}
function wireHandlesMarkup(points) {
  return wireSegments(points).map(s => `<g class="wire-segment ${s.horizontal ? 'is-horizontal' : 'is-vertical'} ${selectedSegmentIndex === s.index ? 'is-active' : ''}" data-wire-segment="${s.index}" role="button" tabindex="0" aria-label="Segment ${s.index + 1} · move ${s.horizontal ? 'up or down' : 'left or right'}"><title>Segment ${s.index + 1}: drag ${s.horizontal ? 'up/down' : 'left/right'} · arrow keys nudge</title><path class="segment-hit" d="M${s.a.x} ${s.a.y} L${s.b.x} ${s.b.y}" stroke="transparent" stroke-width="14" fill="none"/><rect class="segment-grip" x="${s.midpoint.x - 4.5}" y="${s.midpoint.y - 4.5}" width="9" height="9" rx="2" fill="${selectedSegmentIndex === s.index ? '#087f73' : '#ffffff'}" stroke="#087f73" stroke-width="1.5" vector-effect="non-scaling-stroke"/></g>`).join('');
}
function wireSegmentControls(w, route) {
  const segments = wireSegments(route?.points);
  const rerouteButton = '<button class="secondary full-width" data-action="reset-wire-route" title="Find a new path for this wire while keeping all other wires in place">Auto-route this wire</button>';
  if (!segments.length) return rerouteButton;
  selectedSegmentIndex = Math.max(0, Math.min(segments.length - 1, selectedSegmentIndex ?? 0));
  const current = segments[selectedSegmentIndex];
  return `<section class="segment-controls"><div class="segment-heading"><strong>Move wire sections</strong><span>${w.manual ? 'Manual route' : project.settings.autoRoute ? 'Automatic route' : 'Fixed route'}</span></div><p>Drag a segment or square handle. Only this wire moves; the other wire paths stay in place.</p>${field('Segment', `<select id="wire-segment-select" aria-label="Wire segment">${segments.map(s => `<option value="${s.index}" ${s.index === selectedSegmentIndex ? 'selected' : ''}>Segment ${s.index + 1} · ${s.horizontal ? 'horizontal' : 'vertical'}</option>`).join('')}</select>`)}${field(current.horizontal ? 'Vertical position (Y)' : 'Horizontal position (X)', `<div class="size-input"><input id="wire-segment-position" type="number" min="-100000" max="100000" step="${project.settings.snap ? project.settings.grid : 1}" value="${Math.round(current.coordinate * 1000000) / 1000000}" aria-label="Segment position"><span>px</span></div>`)}${rerouteButton}</section>`;
}
function wireMarkup(w, exporting = false, visibleWireIds = null) {
  const r = routing.routes[w.id], from = geo.ports[w.from], to = geo.ports[w.to];
  if (!r || !from || !to) return '';
  if (!r.points?.length) {
    if (exporting) return '';
    return `<g data-wire="${esc(w.id)}" role="button" tabindex="0" aria-label="${esc(from.name + ' to ' + to.name + ' · route blocked')}"><path d="M${from.x} ${from.y} h${from.side === 'left' ? -22 : 22} M${to.x} ${to.y} h${to.side === 'left' ? -22 : 22}" stroke="#db6657" stroke-width="3" stroke-dasharray="4 3" fill="none"/><title>Route blocked — move items apart or auto-route this wire</title></g>`;
  }
  const crossings = visibleWireIds ? (r.crossings || []).filter(c => visibleWireIds.has(c.otherWireId)) : r.crossings;
  const d = routePath(r.points, crossings), color = safeColor(w.color), white = color.toLowerCase() === '#ffffff';
  let out = `<g class="wire ${selectedWire === w.id && !exporting ? 'is-selected' : ''}" ${exporting ? '' : `data-wire="${esc(w.id)}" role="${selectedWire === w.id ? 'group' : 'button'}" tabindex="${selectedWire === w.id ? '-1' : '0'}" aria-label="${esc(from.name + ' to ' + to.name)}"`}>`;
  if (!exporting) {
    out += `<path class="wire-hit" d="${d}" fill="none" stroke="transparent" stroke-width="15" pointer-events="stroke"/><title>${esc(from.name)} → ${esc(to.name)}</title>`;
    if (selectedWire === w.id) out += `<path d="${d}" fill="none" stroke="#4ac0b7" stroke-opacity=".25" stroke-width="${w.width + 9}" pointer-events="none"/>`;
    if (r.status === 'blocked') out += `<path d="${d}" fill="none" stroke="#db6657" stroke-opacity=".5" stroke-width="${w.width + 6}" stroke-dasharray="6 5" pointer-events="none"/><title>Path kept in place · move the obstruction or adjust this wire</title>`;
  }
  if (white) out += `<path d="${d}" fill="none" stroke="#8898a5" stroke-width="${w.width + 1.5}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`;
  out += `<path class="wire-visible" d="${d}" fill="none" stroke="${color}" stroke-width="${w.width}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`;
  if (!exporting && selectedWire === w.id) out += wireHandlesMarkup(r.points);
  out += '</g>';
  return out;
}

function computeRoutes({ baselineWires = null, ...options } = {}) {
  geo = geometry(project.nodes, MODULE_TYPES);
  try {
    // Always adapt a drag from its starting geometry so bends do not drift
    // as the pointer travels out and back across the canvas.
    const startingWires = baselineWires || (gesture && ['nodes', 'resize'].includes(gesture.kind) ? gesture.before.wires : null);
    const baseline = startingWires ? new Map(startingWires.map(w => [w.id, w.savedRoute])) : null;
    const wires = baseline ? project.wires.map(w => ({ ...w, savedRoute: baseline.get(w.id) })) : project.wires;
    const result = routeWithPreferences({ wires, ...geo, grid: project.settings.grid, gap: Math.max(10, project.settings.grid), autoRoute: project.settings.autoRoute === true, ...options });
    routing = result;
    for (const wire of project.wires) if (result.savedRoutes[wire.id]) wire.savedRoute = result.savedRoutes[wire.id];
  }
  catch (error) { routing = { routes: {}, diagnostics: { blocked: project.wires.length } }; console.error(error); notify('Could not route wires. Move the items farther apart and reroute.', true); }
}
function rerouteWires(wireId = null) {
  commitTextEdit();
  const targets = wireId ? project.wires.filter(w => w.id === wireId) : project.wires;
  if (!targets.length) return notify('Connect a wire before routing.');
  const before = clone(project);
  for (const wire of targets) { delete wire.manual; delete wire.savedRoute; }
  computeRoutes(wireId ? { rerouteIds: [wireId] } : { rerouteAll: true });
  const failed = targets.some(w => !routing.routes[w.id] || routing.routes[w.id].status === 'blocked');
  if (failed) {
    project = before; render({ preserveRoutes: true });
    return notify('No clear new route was found. The previous wire paths are kept in place.', true);
  }
  selectedSegmentIndex = null;
  if (JSON.stringify(before) !== JSON.stringify(project)) remember(before);
  render(false); saveLocal();
  notify(routing.diagnostics?.blocked ? 'Some paths still need room. Move the obstruction or adjust the affected wire.' : wireId ? 'Selected wire auto-routed · other wires kept in place' : 'All wires auto-routed · Undo restores the previous paths');
}
function renderBoard(reroute = false) {
  if (reroute) computeRoutes(typeof reroute === 'object' ? reroute : {}); else geo = geometry(project.nodes, MODULE_TYPES);
  const wires = selectedWire ? [...project.wires.filter(w => w.id !== selectedWire), ...project.wires.filter(w => w.id === selectedWire)] : project.wires;
  $('#wires-layer').innerHTML = wires.map(w => wireMarkup(w)).join('');
  $('#nodes-layer').innerHTML = project.nodes.map(n => n.kind === 'module' ? moduleMarkup(n) : deviceMarkup(n)).join('');
  renderOverlay();
  $('#board-count').textContent = `${project.nodes.filter(n => n.kind === 'module').length} modules · ${project.nodes.filter(n => n.kind === 'device').length} devices · ${project.wires.length} wires`;
  $('#canvas-hint').hidden = project.nodes.length > 0;
  const blocked = routing.diagnostics?.blocked || 0;
  if (blocked) $('#status-message').textContent = `${blocked} wire${blocked > 1 ? 's need' : ' needs'} more room. Move the obstruction or adjust the affected wire.`;
  canvas.dataset.routeBlocked = String(blocked);
  canvas.dataset.wireCount = String(project.wires.length);
}
function scheduleRoutes() {
  if (routeFrame) return;
  routeFrame = requestAnimationFrame(() => { routeFrame = 0; renderBoard(true); });
}
function render(reroute = false) {
  setupGrid(); renderBoard(reroute); renderInspector(); renderNavigation(); renderDeviceList(); syncControls(); syncView();
}
function syncControls() {
  if (document.activeElement !== $('#project-title')) $('#project-title').value = project.title;
  $('#snap-toggle').checked = project.settings.snap;
  $('#auto-route-toggle').checked = project.settings.autoRoute === true;
  $('#routing-mode').textContent = project.settings.autoRoute ? 'Live auto-route on' : 'Wires stay in place';
  $('#grid-size').value = String(project.settings.grid);
  $('[data-action="undo"]').disabled = !undoStack.length;
  $('[data-action="redo"]').disabled = !redoStack.length;
  $('[data-action="select-tool"]').classList.toggle('active', tool === 'select');
  $('[data-action="select-tool"]').setAttribute('aria-pressed', String(tool === 'select'));
  $('[data-action="pan-tool"]').classList.toggle('active', tool === 'pan');
  $('[data-action="pan-tool"]').setAttribute('aria-pressed', String(tool === 'pan'));
  stage.classList.toggle('is-panning', tool === 'pan' || spaceDown);
  stage.classList.toggle('is-connecting', !!pendingPort);
}
function renderOverlay() {
  let html = '';
  if (gesture?.kind === 'wire-segment' && gesture.moved && gesture.candidate) {
    const w = project.wires.find(wire => wire.id === gesture.wireId);
    const d = routePath(gesture.candidate), color = safeColor(w?.color);
    html += `<g class="manual-route-preview" pointer-events="none"><path d="${d}" fill="none" stroke="#0d9488" stroke-opacity=".18" stroke-width="${(w?.width || 2.5) + 8}" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (color.toLowerCase() === '#ffffff') html += `<path d="${d}" fill="none" stroke="#8898a5" stroke-width="${(w?.width || 2.5) + 1.5}" stroke-linecap="round" stroke-linejoin="round"/>`;
    html += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w?.width || 2.5}" stroke-linecap="round" stroke-linejoin="round"/>${wireSegments(gesture.candidate).map(s => `<rect x="${s.midpoint.x - 3.5}" y="${s.midpoint.y - 3.5}" width="7" height="7" rx="1.5" fill="#ffffff" stroke="#087f73" stroke-width="1.5"/>`).join('')}</g>`;
  }
  if (pendingPort && pointer && geo.ports[pendingPort]) {
    const start = geo.ports[pendingPort], target = snapTarget ? geo.ports[snapTarget] : pointer;
    const stubX = start.x + (start.side === 'left' ? -30 : 30);
    html += `<path d="M${start.x} ${start.y} H${stubX} V${target.y} H${target.x}" fill="none" stroke="${start.color || '#0d9488'}" stroke-width="2.5" stroke-dasharray="6 4" pointer-events="none"/>`;
    if (snapTarget) html += `<circle cx="${target.x}" cy="${target.y}" r="12" fill="#0d9488" fill-opacity=".12" stroke="#0d9488" stroke-width="1.5" pointer-events="none"/>`;
  }
  if (gesture?.kind === 'marquee' && pointer) {
    const a = gesture.start;
    html += `<rect x="${Math.min(a.x, pointer.x)}" y="${Math.min(a.y, pointer.y)}" width="${Math.abs(a.x - pointer.x)}" height="${Math.abs(a.y - pointer.y)}" fill="#0d9488" fill-opacity=".08" stroke="#0d9488" stroke-width="1" stroke-dasharray="5 3" pointer-events="none"/>`;
  }
  $('#overlay-layer').innerHTML = html;
}

function renderDeviceList() {
  const list = $('#device-list'), scope = focusedModuleId ? focusNodesForModule(focusedModuleId, project) : project.nodes;
  const picked = selectedNode();
  if (picked?.kind === 'device' && !scope.includes(picked)) scope.push(picked);
  const devices = scope.filter(n => n.kind === 'device');
  list.innerHTML = devices.length ? devices.map(n => `<button class="device-list-item ${selected.has(n.id) ? 'active' : ''}" data-select-node="${esc(n.id)}"><span class="list-cable">${esc(n.cable || '—')}</span><span><strong>${esc(n.name || 'Unnamed device')}</strong><small>${n.wireCount} wires · ${project.wires.filter(w => w.from.startsWith(n.id + ':')).length} connected</small></span></button>`).join('') : '<p class="muted-empty">Add a device, then connect its conductor dots to module ports.</p>';
}
function field(label, content, note = '') { return `<label class="field"><span>${label}</span>${content}${note ? `<small>${note}</small>` : ''}</label>`; }
function textInput(prop, value, extra = '') { return `<input data-prop="${prop}" value="${esc(value)}" ${extra}>`; }
function assignmentMarkup(n) {
  const a = n.assignment, m = a && nodeById(a.moduleId);
  if (!m) return '';
  const pending = m.type === 'AI_RTD' && CONDUCTORS[n.wireCount].some(c => !occupied(`${n.id}:${c.key}`))
    ? 'RTD mapping needed: the source does not identify which cable colors connect to M+, M−, I+, and I−.'
    : m.type === 'DQ' && !occupied(`${n.id}:black`) ? 'Black return remains unassigned. The source shows a shared 0 V area without individual return terminals.' : '';
  return `<section class="assignment-card"><span class="eyebrow">CHANNEL ASSIGNMENT</span><button class="text-button" data-focus-module="${esc(m.id)}">${esc(m.rio)} · Slot ${esc(m.slot)} · CH${a.channel}</button><code>${esc(a.tag)}</code>${!n.cable ? '<small>Cable number was not supplied.</small>' : ''}${pending ? `<p class="mapping-note">${esc(pending)}</p>` : ''}</section>`;
}
function moduleChannelsMarkup(n) {
  const source = RIO_SCHEDULE.find(s => s.id === n.scheduleId), t = MODULE_TYPES[n.type];
  const channels = [...new Set(t.ports.map(p => p.channel).filter(c => c !== null))].sort((a, b) => a - b);
  return `<section class="channel-schedule"><h3>Channel assignments</h3>${channels.map(channel => {
    const original = source?.channels.find(c => c.channel === channel);
    const assigned = project.nodes.find(d => d.kind === 'device' && d.assignment?.moduleId === n.id && d.assignment.channel === channel);
    const wire = project.wires.find(w => w.to.startsWith(n.id + ':') && geo.ports[w.to]?.channel === channel);
    const device = assigned || (wire && nodeById(wire.from.split(':')[0]));
    const label = `<span class="channel-number">CH${channel}</span><span><strong>${esc(device?.name || 'Spare')}</strong>${device ? `<small>Cable ${esc(device.cable || '—')}</small>` : '<small>No device assigned</small>'}${original ? `<code>${esc(original.tag)}</code>` : ''}</span>`;
    return device ? `<button class="channel-row" data-select-node="${esc(device.id)}">${label}</button>` : `<div class="channel-row is-spare">${label}</div>`;
  }).join('')}${source?.typeInferred ? `<p class="source-note">The sheet labels this module AI. The ${esc(t.label)} artwork is selected from your references using its channel count${source.channels.some(c => c.device) ? ' and device names' : ''}.</p>` : ''}</section>`;
}
function renderInspector() {
  if (renderingInspector) return;
  renderingInspector = true;
  try {
  commitTextEdit();
  const root = $('#inspector-content'), n = selectedNode(), w = project.wires.find(w => w.id === selectedWire);
  if (pendingPort && geo.ports[pendingPort]) {
    root.innerHTML = `<div class="inspector-heading"><span class="eyebrow">CONNECTING</span><h2>Choose a terminal</h2><p>${esc(geo.ports[pendingPort].name)}</p></div><div class="instruction-card">Click a ${geo.ports[pendingPort].kind === 'device' ? 'channel port on a module' : 'conductor dot on a device'} to finish the wire. A teal ring appears when it snaps into place.</div><button class="secondary full-width" data-action="cancel-wire">Cancel connection <kbd>Esc</kbd></button>`; return;
  }
  if (w) {
    const a = geo.ports[w.from], b = geo.ports[w.to], r = routing.routes[w.id];
    root.innerHTML = `<div class="inspector-heading"><span class="eyebrow">WIRE PROPERTIES</span><h2>Connection</h2><p>Drag a segment to adjust this wire.</p></div><div class="connection-summary"><span>${esc(a?.name)}</span><span class="connection-arrow">↓</span><span>${esc(b?.name)}</span></div>${wireSegmentControls(w, r)}${field('Wire color', `<div class="color-field"><input type="color" data-wire-prop="color" value="${safeColor(w.color)}"><input data-wire-prop="color" value="${safeColor(w.color)}" pattern="#[0-9a-fA-F]{6}" maxlength="7" aria-label="Wire hex color"></div>`)}${field('Thickness', `<div class="range-field"><input type="range" min="1" max="8" step=".5" data-wire-prop="width" value="${w.width}"><output>${w.width} px</output></div>`)}<div class="route-note ${r?.status === 'blocked' ? 'warning' : ''}">${r?.status === 'blocked' ? 'This path needs more room. Move the obstruction, adjust a segment, or auto-route this wire.' : r?.crossings?.length ? 'Separate lanes · bridges at crossings' : `${w.manual ? 'Manual' : project.settings.autoRoute ? 'Automatic' : 'Fixed'} route · separate wire lanes`}</div><div class="inspector-actions"><button class="secondary" data-action="reconnect">Reconnect wire</button><button class="danger" data-action="delete">Delete wire</button></div>`; return;
  }
  if (n?.kind === 'device') {
    const count = project.wires.filter(w => w.from.startsWith(n.id + ':')).length;
    const sizeControls = `<div class="label-size-fields">${field('Width', `<div class="size-input">${textInput('width', deviceWidth(n), `type="number" min="${DEVICE_MIN_WIDTH}" max="${DEVICE_MAX_WIDTH}" step="1" aria-label="Label width"`)}<span>px</span></div>`)}${field('Height', `<div class="size-input">${textInput('height', deviceHeight(n), `type="number" min="${deviceMinHeight(n)}" max="${DEVICE_MAX_HEIGHT}" step="1" aria-label="Label height"`)}<span>px</span></div>`)}</div><div class="size-help"><span>Or drag the resize handles.</span><button type="button" data-action="reset-device-size">Reset size</button></div>`;
    root.innerHTML = `<div class="inspector-heading"><span class="eyebrow">DEVICE PROPERTIES</span><h2>Device label</h2><p>${count} of ${n.wireCount} conductors connected</p></div>${assignmentMarkup(n)}${field('Device name', textInput('name', n.name, 'maxlength="100"'))}${field('Cable number', textInput('cable', n.cable, 'maxlength="24" placeholder="e.g. 17"'))}${sizeControls}${field('Conductors', `<select data-prop="wireCount"><option value="2" ${n.wireCount === 2 ? 'selected' : ''}>2-wire · black / white</option><option value="4" ${n.wireCount === 4 ? 'selected' : ''}>4-wire · red / black / white / green</option></select>`)}${field('Cable number position', `<div class="segmented"><button data-device-side="left" class="${n.cableSide === 'left' ? 'active' : ''}">Left</button><button data-device-side="right" class="${n.cableSide === 'right' ? 'active' : ''}">Right</button></div>`)}${field('Wires leave from', `<select data-prop="wireSide"><option value="left" ${n.wireSide === 'left' ? 'selected' : ''}>Left edge</option><option value="right" ${n.wireSide === 'right' ? 'selected' : ''}>Right edge</option></select>`)}<div class="conductor-list">${CONDUCTORS[n.wireCount].map(c => `<label class="conductor-row"><input type="color" data-conductor="${c.key}" value="${safeColor(n.colors?.[c.key], c.color)}"><span>${c.name}</span><small>${occupied(`${n.id}:${c.key}`) ? 'Connected' : 'Free'}</small></label>`).join('')}</div><div class="inspector-actions"><button class="secondary" data-action="flip-device">Flip label & ports</button><button class="secondary" data-action="duplicate">Duplicate</button><button class="danger" data-action="delete">Delete device</button></div>`; return;
  }
  if (n?.kind === 'module') {
    const t = MODULE_TYPES[n.type];
    root.innerHTML = `<div class="inspector-heading"><span class="eyebrow">MODULE PROPERTIES</span><h2>${esc(t.label)}</h2><p>${esc(t.subtitle || '')}</p></div>${field('Display name', textInput('name', n.name, 'maxlength="70"'))}${field('RIO / location', textInput('rio', n.rio, 'maxlength="35"'))}${field('Slot', textInput('slot', n.slot, 'maxlength="20" placeholder="e.g. 5"'))}<div class="module-description">${esc(t.description || '')}</div><div class="terminal-count"><strong>${t.ports.length}</strong> labeled connection points</div>${moduleChannelsMarkup(n)}<div class="inspector-actions"><button class="secondary" data-action="duplicate">Duplicate module</button><button class="danger" data-action="delete">Delete module</button></div>`; return;
  }
  if (selected.size > 1) {
    root.innerHTML = `<div class="inspector-heading"><span class="eyebrow">SELECTION</span><h2>${selected.size} items</h2><p>Drag any selected item to move the group. Arrow keys nudge by one grid step.</p></div><div class="inspector-actions"><button class="secondary" data-action="duplicate">Duplicate selected</button><button class="danger" data-action="delete">Delete selected</button></div>`; return;
  }
  root.innerHTML = `<div class="inspector-heading"><span class="eyebrow">YOUR WORKSPACE</span><h2>Make a connection</h2><p>Select an item to edit its details.</p></div><div class="guide-step"><b>1</b><div><strong>Place your hardware</strong><p>Add a module and a 2-wire or 4-wire device from the library.</p></div></div><div class="guide-step"><b>2</b><div><strong>Connect the dots</strong><p>Click a conductor, then a channel port. You can also drag between them.</p></div></div><div class="guide-step"><b>3</b><div><strong>Arrange and export</strong><p>Move components on the grid; their wires stay attached. Other wire paths stay in place while Auto-route is off.</p></div></div>${field('New wire thickness', `<select id="default-width"><option value="1.5" ${project.settings.defaultWidth === 1.5 ? 'selected' : ''}>1.5 px · fine</option><option value="2.5" ${project.settings.defaultWidth === 2.5 ? 'selected' : ''}>2.5 px · standard</option><option value="4" ${project.settings.defaultWidth === 4 ? 'selected' : ''}>4 px · bold</option><option value="6" ${project.settings.defaultWidth === 6 ? 'selected' : ''}>6 px · heavy</option></select>`)}<div class="instruction-card">Your project autosaves in this browser. Use <strong>Save project</strong> for a reusable backup.</div>`;
  } finally { renderingInspector = false; }
}

function nearestPort(pos) {
  if (!pendingPort || !geo.ports[pendingPort]) return null;
  const first = geo.ports[pendingPort]; let best = null, distance = 22 / view.zoom;
  for (const p of Object.values(geo.ports)) {
    if (p.kind === first.kind || p.id === first.id) continue;
    const d = Math.hypot(pos.x - p.x, pos.y - p.y);
    if (d < distance) { best = p.id; distance = d; }
  }
  return best;
}
function beginWire(id) {
  if (!geo.ports[id]) return;
  selected.clear(); selectedWire = null; pendingPort = id; pointer = { x: geo.ports[id].x, y: geo.ports[id].y }; snapTarget = null;
  render(false); $('#status-message').textContent = `Connecting ${geo.ports[id].name} — choose the matching terminal`;
}
function finishWire(id) {
  const first = geo.ports[pendingPort], last = geo.ports[id];
  if (!first || !last) return false;
  if (first.id === last.id) { cancelWire(); return false; }
  if (first.kind === last.kind) { notify('Connect a device conductor to a module channel.', true); return false; }
  const from = first.kind === 'device' ? first : last, to = first.kind === 'module' ? first : last;
  const previous = project.wires.find(w => w.from === from.id), taken = occupied(to.id, previous?.id);
  if (taken && !to.allowMultiple && !to.common) { notify('That channel terminal is occupied. Select its wire to reconnect or delete it.', true); return false; }
  const idNew = previous?.id || makeId('wire');
  change(() => {
    if (previous) { previous.to = to.id; delete previous.manual; delete previous.savedRoute; }
    else project.wires.push({ id: idNew, from: from.id, to: to.id, color: from.color, width: project.settings.defaultWidth });
    pendingPort = null; snapTarget = null; selectedWire = idNew;
  }, `${from.name} connected to ${to.name}`, { rerouteIds: [idNew] });
  return true;
}
function cancelWire() { pendingPort = null; snapTarget = null; render(false); $('#status-message').textContent = 'Connection cancelled'; }

function cancelResize() {
  if (gesture?.kind !== 'resize') return;
  const active = gesture; gesture = null; project = active.before;
  if (canvas.hasPointerCapture(active.pointerId)) canvas.releasePointerCapture(active.pointerId);
  if (routeFrame) { cancelAnimationFrame(routeFrame); routeFrame = 0; }
  render({ preserveRoutes: true }); saveLocal(); notify('Resize cancelled');
}
function cancelSegmentMove() {
  if (gesture?.kind !== 'wire-segment') return;
  const active = gesture; gesture = null;
  if (canvas.hasPointerCapture(active.pointerId)) canvas.releasePointerCapture(active.pointerId);
  render(false); saveLocal(); notify('Wire segment move cancelled');
}

canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 && event.button !== 1) return;
  const pos = world(event); pointer = pos;
  const portEl = event.target.closest('[data-port]');
  const nodeEl = event.target.closest('[data-node]'), wireEl = event.target.closest('[data-wire]');
  const resizeEl = event.target.closest('[data-resize]');
  if (event.button === 1 || spaceDown || tool === 'pan') {
    gesture = { kind: 'pan', clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y }; canvas.setPointerCapture(event.pointerId); event.preventDefault(); return;
  }
  if (portEl) {
    const id = portEl.dataset.port;
    if (pendingPort) { finishWire(id); event.preventDefault(); return; }
    beginWire(id); gesture = { kind: 'wire', start: pos, moved: false }; canvas.setPointerCapture(event.pointerId); event.preventDefault(); return;
  }
  if (pendingPort) { cancelWire(); return; }
  if (resizeEl && nodeEl) {
    const n = nodeById(nodeEl.dataset.node);
    if (n?.kind !== 'device') return;
    commitTextEdit(); clearTimeout(autosaveTimer);
    selected = new Set([n.id]); selectedWire = null;
    gesture = { kind: 'resize', nodeId: n.id, axis: resizeEl.dataset.resize, start: pos,
      width: deviceWidth(n), height: deviceHeight(n), before: clone(project), moved: false, pointerId: event.pointerId };
    canvas.setPointerCapture(event.pointerId); render(false); event.preventDefault(); return;
  }
  if (nodeEl) {
    const id = nodeEl.dataset.node;
    if (event.shiftKey) { if (selected.has(id)) selected.delete(id); else selected.add(id); }
    else if (!selected.has(id)) selected = new Set([id]);
    selectedWire = null;
    gesture = { kind: 'nodes', start: pos, before: clone(project), positions: project.nodes.filter(n => selected.has(n.id)).map(n => ({ id: n.id, x: n.x, y: n.y })), moved: false };
    canvas.setPointerCapture(event.pointerId); render(false); event.preventDefault(); return;
  }
  if (wireEl) {
    commitTextEdit();
    selected.clear(); selectedWire = wireEl.dataset.wire;
    const route = routing.routes[selectedWire], segmentEl = event.target.closest('[data-wire-segment]');
    selectedSegmentIndex = segmentEl ? Number(segmentEl.dataset.wireSegment) : nearestWireSegment(route?.points || [], pos);
    const segment = wireSegments(route?.points)[selectedSegmentIndex];
    if (segment) {
      gesture = { kind: 'wire-segment', wireId: selectedWire, segmentIndex: segment.index, horizontal: segment.horizontal,
        start: pos, coordinate: segment.coordinate, midpoint: segment.midpoint, original: clone(route.points), candidate: null,
        before: clone(project), moved: false, pointerId: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
    }
    render(false); event.preventDefault(); return;
  }
  if (!event.shiftKey) clearSelection();
  gesture = { kind: 'marquee', start: pos, additive: event.shiftKey, previous: new Set(selected) };
  canvas.setPointerCapture(event.pointerId); render(false); event.preventDefault();
});
canvas.addEventListener('pointermove', event => {
  const pos = world(event); pointer = pos;
  if (gesture?.kind === 'pan') { view.x = gesture.x - (event.clientX - gesture.clientX) / view.zoom; view.y = gesture.y - (event.clientY - gesture.clientY) / view.zoom; syncView(); return; }
  if (gesture?.kind === 'wire-segment') {
    const w = project.wires.find(wire => wire.id === gesture.wireId); if (!w) return;
    const delta = gesture.horizontal ? pos.y - gesture.start.y : pos.x - gesture.start.x;
    if (Math.abs(delta) > 2 / view.zoom) gesture.moved = true;
    if (gesture.moved) {
      const coordinate = gesture.coordinate + delta;
      gesture.candidate = moveWireSegment(gesture.original, gesture.segmentIndex, coordinate, segmentOptions(w));
      gesture.movedAt = { ...gesture.midpoint, horizontal: gesture.horizontal, [gesture.horizontal ? 'y' : 'x']: snapped(coordinate) };
      canvas.querySelector(`[data-wire="${CSS.escape(w.id)}"]`)?.setAttribute('opacity', '.2');
      const positionInput = $('#wire-segment-position'); if (positionInput) positionInput.value = snapped(coordinate);
      $('#status-message').textContent = 'Move the segment · release to apply · Esc to cancel';
      renderOverlay();
    }
    return;
  }
  if (gesture?.kind === 'resize') {
    const n = nodeById(gesture.nodeId); if (!n) return;
    const dx = pos.x - gesture.start.x, dy = pos.y - gesture.start.y;
    const distance = gesture.axis === 'e' ? Math.abs(dx) : gesture.axis === 's' ? Math.abs(dy) : Math.hypot(dx, dy);
    if (distance > 2 / view.zoom) gesture.moved = true;
    if (gesture.moved) {
      if (gesture.axis.includes('e')) n.width = deviceWidth({ ...n, width: snapped(gesture.width + dx) });
      if (gesture.axis.includes('s')) n.height = deviceHeight({ ...n, height: snapped(gesture.height + dy) });
      const widthInput = $('[data-prop="width"]'), heightInput = $('[data-prop="height"]');
      if (widthInput) widthInput.value = deviceWidth(n);
      if (heightInput) heightInput.value = deviceHeight(n);
      scheduleRoutes();
    }
    return;
  }
  if (gesture?.kind === 'nodes') {
    const dx = pos.x - gesture.start.x, dy = pos.y - gesture.start.y;
    if (Math.hypot(dx, dy) > 2 / view.zoom) gesture.moved = true;
    if (gesture.moved) {
      for (const p of gesture.positions) { const n = nodeById(p.id); if (n) { n.x = snapped(p.x + dx); n.y = snapped(p.y + dy); } }
      scheduleRoutes();
    }
    return;
  }
  if (pendingPort) {
    if (gesture?.kind === 'wire' && Math.hypot(pos.x - gesture.start.x, pos.y - gesture.start.y) > 6 / view.zoom) gesture.moved = true;
    snapTarget = nearestPort(pos); renderOverlay(); return;
  }
  if (gesture?.kind === 'marquee') renderOverlay();
});
canvas.addEventListener('pointerup', event => {
  const active = gesture; gesture = null;
  if (routeFrame) { cancelAnimationFrame(routeFrame); routeFrame = 0; }
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (!active) return;
  if (active.kind === 'wire-segment') {
    if (active.moved) commitWireSegment(active.wireId, active.candidate, active.before, active.movedAt);
    else { render(false); saveLocal(); }
    return;
  }
  if (active.kind === 'resize') {
    const n = nodeById(active.nodeId);
    if (n && (deviceWidth(n) !== active.width || deviceHeight(n) !== active.height)) {
      remember(active.before); render({ baselineWires: active.before.wires }); saveLocal(); notify(`Label resized · ${deviceWidth(n)} × ${deviceHeight(n)} px`);
    } else { project = active.before; render({ preserveRoutes: true }); saveLocal(); }
    return;
  }
  if (active.kind === 'nodes' && active.moved) { remember(active.before); render({ baselineWires: active.before.wires }); saveLocal(); }
  if (active.kind === 'wire' && active.moved) {
    const id = nearestPort(world(event));
    if (id) finishWire(id); else { renderOverlay(); notify('Click a channel port to finish, or press Esc to cancel.'); }
  }
  if (active.kind === 'marquee') {
    const p = world(event), x1 = Math.min(active.start.x, p.x), y1 = Math.min(active.start.y, p.y), x2 = Math.max(active.start.x, p.x), y2 = Math.max(active.start.y, p.y);
    if (!active.additive) selected.clear();
    if (Math.abs(x2 - x1) > 3 || Math.abs(y2 - y1) > 3) {
      for (const n of project.nodes) { const w = n.kind === 'module' ? MODULE_TYPES[n.type].width : deviceWidth(n), h = n.kind === 'module' ? MODULE_TYPES[n.type].height : deviceHeight(n); if (n.x >= x1 && n.x + w <= x2 && n.y >= y1 && n.y + h <= y2) selected.add(n.id); }
    }
    render(false);
  }
});
canvas.addEventListener('pointercancel', () => { if (gesture?.kind === 'wire-segment') return cancelSegmentMove(); if (gesture?.kind === 'resize') return cancelResize(); if (gesture?.kind === 'nodes' && gesture.moved) project = gesture.before; gesture = null; if (routeFrame) { cancelAnimationFrame(routeFrame); routeFrame = 0; } render({ preserveRoutes: true }); });
canvas.addEventListener('wheel', event => { event.preventDefault(); if (['resize', 'wire-segment'].includes(gesture?.kind)) return; zoomBy(Math.exp(-event.deltaY * .0014), { x: event.clientX, y: event.clientY }); }, { passive: false });
canvas.addEventListener('dblclick', event => { if (event.target.closest('[data-resize]')) return; const n = event.target.closest('[data-node]'); if (n) { selected = new Set([n.dataset.node]); selectedWire = null; renderInspector(); const input = $('[data-prop="name"]'); input?.focus(); input?.select(); } });

function findFreePosition(node, desired) {
  const w = node.kind === 'module' ? MODULE_TYPES[node.type].width : deviceWidth(node);
  const h = node.kind === 'module' ? MODULE_TYPES[node.type].height + 36 : deviceHeight(node);
  const top = node.kind === 'module' ? 36 : 0;
  const obstacles = geometry(project.nodes, MODULE_TYPES).obstacles;
  const free = (x, y) => obstacles.every(r => x + w + 45 < r.x || x - 45 > r.x + r.width || y - top + h + 45 < r.y || y - top - 45 > r.y + r.height);
  const candidates = [];
  for (let ring = 0; ring <= 12; ring++) {
    for (let dx = -ring; dx <= ring; dx++) for (let dy = -ring; dy <= ring; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const x = snapped(desired.x + dx * 80), y = snapped(desired.y + dy * 80);
      if (free(x, y)) candidates.push({ x, y, distance: dx * dx + dy * dy });
    }
    if (candidates.length) return candidates.sort((a, b) => a.distance - b.distance)[0];
  }
  const bounds = boundsOf(project.nodes, MODULE_TYPES);
  return { x: snapped(bounds.x + bounds.width + 100), y: snapped(desired.y) };
}
function addModule(type) {
  const c = viewportCenter(), n = newModule(type);
  Object.assign(n, findFreePosition(n, { x: c.x - MODULE_TYPES[type].width / 2, y: c.y - MODULE_TYPES[type].height / 2 }));
  change(() => { project.nodes.push(n); selected = new Set([n.id]); selectedWire = null; }, `${MODULE_TYPES[type].label} module added`);
  fitBoard();
}
function addDevice(count) {
  const c = viewportCenter(), n = newDevice(count);
  Object.assign(n, findFreePosition(n, { x: c.x - deviceWidth(n) / 2, y: c.y - deviceHeight(n) / 2 }));
  change(() => { project.nodes.push(n); selected = new Set([n.id]); selectedWire = null; }, `${count}-wire device added`);
  fitBoard();
  $('[data-prop="name"]')?.focus(); $('[data-prop="name"]')?.select();
}
function deleteSelection() {
  if (!selected.size && !selectedWire) return;
  change(() => {
    project.nodes = project.nodes.filter(n => !selected.has(n.id));
    project.wires = project.wires.filter(w => w.id !== selectedWire && !selected.has(w.from.split(':')[0]) && !selected.has(w.to.split(':')[0])); clearSelection();
  }, 'Selection deleted · Undo to restore');
}
function duplicateSelection() {
  const copy = project.nodes.filter(n => selected.has(n.id)); if (!copy.length) return;
  change(() => { const newIds = []; for (const n of copy) { const duplicate = { ...clone(n), id: makeId(n.kind === 'device' ? 'dev' : 'mod'), x: n.x + 40, y: n.y + 40 }; delete duplicate.assignment; delete duplicate.scheduleId; project.nodes.push(duplicate); newIds.push(duplicate.id); } selected = new Set(newIds); }, 'Selection duplicated');
}
function setNodeProperty(prop, value, element = null) {
  const n = selectedNode(); if (!n) return;
  if (['width', 'height'].includes(prop)) {
    if (n.kind !== 'device' || String(value).trim() === '' || !Number.isFinite(Number(value))) return;
    value = prop === 'width' ? deviceWidth({ ...n, width: value }) : deviceHeight({ ...n, height: value });
    if (textEdit?.element === element) {
      n[prop] = value; commitTextEdit(); renderBoard(true); saveLocal(); return;
    }
  }
  if (prop === 'wireCount') value = Number(value) === 4 ? 4 : 2;
  if (['name', 'cable', 'slot', 'rio'].includes(prop)) value = String(value).slice(0, prop === 'name' ? 100 : 40);
  change(() => { n[prop] = value; if (prop === 'wireCount') { if (Object.hasOwn(n, 'height')) n.height = deviceHeight(n); const allowed = new Set(CONDUCTORS[value].map(c => c.key)); project.wires = project.wires.filter(w => !w.from.startsWith(n.id + ':') || allowed.has(w.from.split(':')[1])); } });
}

document.addEventListener('change', event => {
  const el = event.target;
  if (el.id === 'slot-jump') { focusModule(el.value); return; }
  if (el.id === 'wire-segment-select') { selectedSegmentIndex = Number(el.value); render(false); $('#wire-segment-select')?.focus(); return; }
  if (el.id === 'wire-segment-position') { if (el.value.trim() === '') render(false); else moveSelectedSegment(Number(el.value)); return; }
  if (el.dataset.prop) {
    setNodeProperty(el.dataset.prop, el.value, el);
    const n = selectedNode();
    if (n?.kind === 'device' && ['width', 'height'].includes(el.dataset.prop) && el.isConnected) el.value = el.dataset.prop === 'width' ? deviceWidth(n) : deviceHeight(n);
    return;
  }
  if (el.dataset.wireProp) {
    const w = project.wires.find(w => w.id === selectedWire); if (!w) return;
    const prop = el.dataset.wireProp;
    if (prop === 'color' && !/^#[0-9a-fA-F]{6}$/.test(el.value)) { notify('Use a six-digit hex color, such as #ff5500.', true); renderInspector(); return; }
    change(() => { w[prop] = prop === 'width' ? Math.max(1, Math.min(8, Number(el.value))) : el.value; }); return;
  }
  if (el.dataset.conductor) {
    const n = selectedNode(); if (!n) return;
    change(() => { n.colors[el.dataset.conductor] = safeColor(el.value); for (const w of project.wires) if (w.from === `${n.id}:${el.dataset.conductor}`) w.color = el.value; }); return;
  }
  if (el.id === 'snap-toggle') { project.settings.snap = el.checked; saveLocal(); syncControls(); }
  if (el.id === 'auto-route-toggle') { change(() => { project.settings.autoRoute = el.checked; }, el.checked ? 'Live auto-routing enabled for component moves · edited wires stay fixed' : 'Auto-routing off · wire paths stay in place', el.checked ? true : { preserveRoutes: true }); }
  if (el.id === 'grid-size') change(() => { project.settings.grid = Number(el.value); });
  if (el.id === 'default-width') { project.settings.defaultWidth = Number(el.value); saveLocal(); }
  if (el.id === 'project-title') change(() => { project.title = el.value.trim() || 'Untitled wiring'; });
});
document.addEventListener('input', event => {
  const el = event.target;
  if (el.dataset.wireProp === 'width') el.parentElement.querySelector('output').textContent = `${el.value} px`;
  if (el.dataset.wireProp) {
    const w = project.wires.find(w => w.id === selectedWire), prop = el.dataset.wireProp;
    if (!w || (prop === 'color' && !/^#[0-9a-fA-F]{6}$/.test(el.value))) return;
    if (!textEdit || textEdit.element !== el) { commitTextEdit(); textEdit = { element: el, before: clone(project) }; }
    w[prop] = prop === 'width' ? Math.max(1, Math.min(8, Number(el.value))) : el.value;
    if (prop === 'color') document.querySelectorAll('[data-wire-prop="color"]').forEach(input => { if (input !== el) input.value = el.value; });
    renderBoard(prop === 'width'); saveLocal(); return;
  }
  if (el.dataset.conductor) {
    const n = selectedNode(); if (!n) return;
    if (!textEdit || textEdit.element !== el) { commitTextEdit(); textEdit = { element: el, before: clone(project) }; }
    n.colors[el.dataset.conductor] = safeColor(el.value);
    project.wires.forEach(w => { if (w.from === `${n.id}:${el.dataset.conductor}`) w.color = el.value; });
    renderBoard(false); saveLocal(); return;
  }
  const prop = el.dataset.prop;
  if (['width', 'height'].includes(prop)) {
    const n = selectedNode(), value = Number(el.value);
    if (n?.kind !== 'device' || el.value.trim() === '' || !Number.isFinite(value)) return;
    const min = prop === 'width' ? DEVICE_MIN_WIDTH : deviceMinHeight(n), max = prop === 'width' ? DEVICE_MAX_WIDTH : DEVICE_MAX_HEIGHT;
    if (value < min || value > max) return;
    if (!textEdit || textEdit.element !== el) { commitTextEdit(); textEdit = { element: el, before: clone(project) }; }
    n[prop] = prop === 'width' ? deviceWidth({ ...n, width: value }) : deviceHeight({ ...n, height: value });
    renderBoard(true); saveLocal(); return;
  }
  if (['name', 'cable', 'rio', 'slot'].includes(prop) || el.id === 'project-title') {
    if (!textEdit || textEdit.element !== el) textEdit = { element: el, before: clone(project) };
    if (el.id === 'project-title') project.title = el.value.slice(0, 90) || 'Untitled wiring';
    else { const n = selectedNode(); if (!n) return; n[prop] = el.value.slice(0, prop === 'name' ? 100 : 40); }
    renderBoard(false); renderNavigation(); renderDeviceList(); saveLocal();
  }
});
document.addEventListener('focusout', event => {
  if (renderingInspector) return;
  const el = event.target;
  if (el.id === 'wire-segment-position' && el.isConnected) {
    if (el.value.trim() === '') render(false); else moveSelectedSegment(Number(el.value));
    return;
  }
  if (['width', 'height'].includes(el.dataset.prop)) {
    setNodeProperty(el.dataset.prop, el.value, el);
    const n = selectedNode();
    if (n?.kind === 'device' && el.isConnected) el.value = el.dataset.prop === 'width' ? deviceWidth(n) : deviceHeight(n);
  }
  if (textEdit?.element !== event.target) return;
  commitTextEdit(); syncControls();
});

function download(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
}
function fileName(extension, title = project.title) { return (title.replace(/[^a-zA-Z0-9-_ .]/g, '').trim().replace(/\s+/g, '-') || 'wiring-project') + extension; }
function saveProject() { download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), fileName('.wirebench.json')); notify('Editable project file saved'); }
$('#project-file').addEventListener('change', async event => {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('Choose a project file smaller than 8 MB.');
    const incoming = normalizeProject(JSON.parse(await file.text()), MODULE_TYPES);
    applyCompactLabelSize(incoming);
    change(() => { project = incoming; clearSelection(); focusedModuleId = ''; }, 'Project opened', { preserveRoutes: true }); initialView();
  } catch (error) { notify(error.message || 'The project could not be opened.', true); }
});
async function imageData(type) {
  if (imageCache.has(type)) return imageCache.get(type);
  const response = await fetch(MODULE_TYPES[type].image); if (!response.ok) throw new Error('A module image could not be loaded. Please refresh and try again.');
  const blob = await response.blob();
  const result = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
  imageCache.set(type, result); return result;
}
async function exportPNG() {
  if (!project.nodes.length) return notify('Add a module or device before exporting.', true);
  const epoch = ++exportEpoch;
  const button = $('[data-action="confirm-export"]'); button.disabled = true; const previousLabel = button.textContent; button.textContent = 'Preparing PNG…';
  try {
    const embedded = {};
    await Promise.all(Object.keys(MODULE_TYPES).map(async type => { embedded[type] = await imageData(type); }));
    if (epoch !== exportEpoch || !$('#export-dialog').open) return;
    computeRoutes({ preserveRoutes: true });
    const scope = $('#export-scope').value;
    const exportNodes = scope === 'all' ? project.nodes : focusNodesForModule(scope, project);
    if (!exportNodes.length) throw new Error('The selected slot is no longer on the canvas. Choose an export area again.');
    const exportIds = new Set(exportNodes.map(n => n.id));
    const exportWires = project.wires.filter(w => exportIds.has(w.from.split(':')[0]) && exportIds.has(w.to.split(':')[0]));
    const exportRoutes = routesForNodes(exportNodes);
    const blocked = exportWires.filter(w => !routing.routes[w.id] || routing.routes[w.id].status === 'blocked').length;
    if (blocked) throw new Error(`${blocked} wire${blocked === 1 ? ' has' : 's have'} no clear route. Move items apart before exporting.`);
    const transparent = $('#export-transparent').checked, title = $('#export-title').checked, margin = Math.max(0, Math.min(200, Number($('#export-margin').value) || 0));
    const scale = Number($('#export-scale').value) || 2;
    const b = boundsOf(exportNodes, MODULE_TYPES, exportRoutes), titleHeight = title ? 42 : 0;
    const scopeModule = scope === 'all' ? null : nodeById(scope);
    const exportTitle = scopeModule ? `${scopeModule.rio} · Slot ${scopeModule.slot}` : project.title;
    const width = Math.ceil(b.width + 2 * margin), height = Math.ceil(b.height + 2 * margin + titleHeight);
    const actualScale = Math.min(scale, 12000 / width, 12000 / height, Math.sqrt(48000000 / (width * height)));
    const x = b.x - margin, y = b.y - margin - titleHeight;
    const visibleWireIds = new Set(exportWires.map(w => w.id));
    const content = exportWires.map(w => wireMarkup(w, true, visibleWireIds)).join('') + exportNodes.map(n => n.kind === 'module' ? moduleMarkup(n, true, embedded) : deviceMarkup(n, true)).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width * actualScale)}" height="${Math.ceil(height * actualScale)}" viewBox="${x} ${y} ${width} ${height}" font-family="Arial, Helvetica, sans-serif">${transparent ? '' : `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff"/>`}${title ? `<text x="${b.x}" y="${b.y - 20}" font-size="22" font-weight="700" fill="#20303d">${esc(exportTitle)}</text>` : ''}${content}</svg>`;
    const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    let image;
    try { image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Could not render the export. Try a smaller scale.')); img.src = svgUrl; }); }
    finally { URL.revokeObjectURL(svgUrl); }
    if (epoch !== exportEpoch || !$('#export-dialog').open) return;
    const output = document.createElement('canvas'); output.width = Math.ceil(width * actualScale); output.height = Math.ceil(height * actualScale);
    const ctx = output.getContext('2d'); ctx.drawImage(image, 0, 0);
    const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png')); if (!blob) throw new Error('The image is too large. Choose a smaller scale.');
    if (epoch !== exportEpoch || !$('#export-dialog').open) return;
    const alpha = ctx.getImageData(0, 0, 1, 1).data[3];
    download(blob, fileName('.png', exportTitle)); $('#export-dialog').close();
    $('#status-message').dataset.export = JSON.stringify({ width: output.width, height: output.height, transparent, cornerAlpha: alpha, bytes: blob.size, scope, modules: exportNodes.filter(n => n.kind === 'module').length, devices: exportNodes.filter(n => n.kind === 'device').length, wires: exportWires.length });
    notify(`PNG exported · ${output.width} × ${output.height} · ${transparent ? 'transparent background' : 'white background'}`);
  } catch (error) { notify(error.message || 'Export failed. Try again at a smaller scale.', true); }
  finally { button.disabled = false; button.textContent = previousLabel; }
}

const actions = {
  undo, redo, 'save-project': saveProject, 'open-project': () => $('#project-file').click(),
  'add-2wire': () => addDevice(2), 'add-4wire': () => addDevice(4),
  'zoom-in': () => zoomBy(1.2), 'zoom-out': () => zoomBy(1 / 1.2), fit: () => focusModule(''),
  'select-tool': () => { tool = 'select'; syncControls(); }, 'pan-tool': () => { tool = 'pan'; syncControls(); },
  'auto-route': () => rerouteWires(),
  'cancel-wire': cancelWire, delete: deleteSelection, duplicate: duplicateSelection,
  reconnect: () => { const w = project.wires.find(w => w.id === selectedWire); if (w) beginWire(w.from); },
  'flip-device': () => { const n = selectedNode(); if (n?.kind === 'device') change(() => { n.cableSide = n.cableSide === 'left' ? 'right' : 'left'; n.wireSide = n.wireSide === 'left' ? 'right' : 'left'; }); },
  'reset-device-size': () => { const n = selectedNode(); if (n?.kind === 'device') change(() => { delete n.width; delete n.height; }, 'Default label size restored'); },
  'reset-wire-route': () => { if (selectedWire) rerouteWires(selectedWire); },
  'full-schedule': () => {
    commitTextEdit();
    if (!scheduleWorkspace) {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(project)); } catch { return notify('Save a project file before switching workspaces; browser storage is full.', true); }
      location.assign('?project=rio-schedule'); return;
    }
    if (project.sourceSchedule !== 'rio-schedule-v1') change(() => { project = createScheduleProject(); clearSelection(); }, 'Full RIO schedule loaded · Undo to restore');
    initialView();
  },
  'schedule-notes': () => $('#schedule-dialog').showModal(), 'close-schedule-notes': () => $('#schedule-dialog').close(),
  example: () => { if (project.nodes.length && !confirm('Load the complete Slot 5 example? You can undo this or save your current project first.')) return; change(() => { project = exampleProject(true); clearSelection(); }, 'Slot 5 example loaded'); fitBoard(); },
  clear: () => { if (project.nodes.length && !confirm('Start a blank project? You can undo this or save your current project first.')) return; change(() => { project = { ...exampleProject(false), title: 'Untitled wiring', nodes: [], wires: [] }; clearSelection(); }, 'Blank project ready'); fitBoard(); },
  'export-png': () => {
    if (!project.nodes.length) return notify('Add something to the canvas first.');
    const n = nodeById(focusedModuleId);
    $('#export-scope').innerHTML = '<option value="all">Entire diagram</option>' + (n ? `<option value="${esc(n.id)}">Current slot · ${esc(n.rio)} · Slot ${esc(n.slot)}</option>` : '');
    $('#export-scope').value = n ? n.id : 'all';
    $('#export-info').textContent = 'Choose one slot for a detailed drawing, or the entire diagram for all channels.';
    $('#export-dialog').showModal();
  },
  'confirm-export': exportPNG, 'cancel-export': () => { exportEpoch++; $('#export-dialog').close(); }, help: () => $('#help-dialog').showModal(), 'close-help': () => $('#help-dialog').close()
};
$('#export-dialog').addEventListener('cancel', () => { exportEpoch++; });
document.addEventListener('click', event => {
  const focus = event.target.closest('[data-focus-module]'); if (focus) return focusModule(focus.dataset.focusModule);
  const moduleButton = event.target.closest('[data-add-module]'); if (moduleButton) return addModule(moduleButton.dataset.addModule);
  const device = event.target.closest('[data-select-node]');
  if (device) { selected = new Set([device.dataset.selectNode]); selectedWire = null; pendingPort = null; render(false); const n = selectedNode(); if (n) { view.x = n.x + deviceWidth(n) / 2 - stage.clientWidth / view.zoom / 2; view.y = n.y + deviceHeight(n) / 2 - stage.clientHeight / view.zoom / 2; syncView(); } return; }
  const side = event.target.closest('[data-device-side]'); if (side) return setNodeProperty('cableSide', side.dataset.deviceSide);
  const button = event.target.closest('[data-action]'); if (button && actions[button.dataset.action]) actions[button.dataset.action]();
});
document.addEventListener('keydown', event => {
  const editing = /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable;
  if (gesture?.kind === 'wire-segment') { if (event.key === 'Escape') cancelSegmentMove(); event.preventDefault(); return; }
  if (gesture?.kind === 'resize') { if (event.key === 'Escape') cancelResize(); event.preventDefault(); return; }
  if (event.key === 'Escape') { if (pendingPort) cancelWire(); else { clearSelection(); render(false); } return; }
  if (editing || $('dialog[open]')) return;
  const wireHandle = event.target.closest('[data-wire-segment]');
  if (wireHandle) {
    selectedSegmentIndex = Number(wireHandle.dataset.wireSegment);
    const s = wireSegments(routing.routes[selectedWire]?.points)[selectedSegmentIndex];
    if (event.key === 'Enter') { event.preventDefault(); render(false); $('#wire-segment-position')?.focus(); $('#wire-segment-position')?.select(); return; }
    if (s && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      if (s.horizontal ? ['ArrowUp', 'ArrowDown'].includes(event.key) : ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        const step = (project.settings.snap ? project.settings.grid : 1) * (event.shiftKey ? 5 : 1);
        moveSelectedSegment(s.coordinate + (['ArrowDown', 'ArrowRight'].includes(event.key) ? step : -step));
        canvas.querySelector(`[data-wire="${CSS.escape(selectedWire)}"] [data-wire-segment="${selectedSegmentIndex}"]`)?.focus();
      }
      return;
    }
  }
  const resizeHandle = event.target.closest('[data-resize]');
  if (resizeHandle) {
    const n = selectedNode(), axis = resizeHandle.dataset.resize;
    if (n?.kind === 'device' && event.key === 'Enter') {
      event.preventDefault(); const input = $(`[data-prop="${axis === 's' ? 'height' : 'width'}"]`); input?.focus(); input?.select(); return;
    }
    if (n?.kind === 'device' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); const step = project.settings.grid * (event.shiftKey ? 5 : 1);
      change(() => {
        if (axis.includes('e') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) n.width = deviceWidth({ ...n, width: deviceWidth(n) + (event.key === 'ArrowRight' ? step : -step) });
        if (axis.includes('s') && ['ArrowUp', 'ArrowDown'].includes(event.key)) n.height = deviceHeight({ ...n, height: deviceHeight(n) + (event.key === 'ArrowDown' ? step : -step) });
      });
      canvas.querySelector(`[data-node="${CSS.escape(n.id)}"] [data-resize="${axis}"]`)?.focus(); return;
    }
  }
  if (event.key === ' ') { spaceDown = true; syncControls(); event.preventDefault(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject(); }
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); }
  else if (['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); deleteSelection(); }
  else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && selected.size) {
    event.preventDefault(); const step = project.settings.grid * (event.shiftKey ? 5 : 1);
    change(() => { for (const n of project.nodes.filter(n => selected.has(n.id))) { if (event.key === 'ArrowLeft') n.x -= step; if (event.key === 'ArrowRight') n.x += step; if (event.key === 'ArrowUp') n.y -= step; if (event.key === 'ArrowDown') n.y += step; } });
  } else if (event.key.toLowerCase() === 'f') focusModule('');
  else if (event.key.toLowerCase() === 'v') { tool = 'select'; syncControls(); }
  else if (event.key.toLowerCase() === 'h') { tool = 'pan'; syncControls(); }
  else if (event.key === 'Enter' && event.target.closest('[data-port]')) { const id = event.target.closest('[data-port]').dataset.port; pendingPort ? finishWire(id) : beginWire(id); }
  else if (event.key === 'Enter' && event.target.closest('[data-wire]')) { event.preventDefault(); selected.clear(); selectedWire = event.target.closest('[data-wire]').dataset.wire; selectedSegmentIndex = 0; render(false); canvas.querySelector(`[data-wire="${CSS.escape(selectedWire)}"] [data-wire-segment]`)?.focus(); }
});
document.addEventListener('keyup', event => { if (event.key === ' ') { spaceDown = false; syncControls(); } });
window.addEventListener('blur', () => { if (gesture?.kind === 'wire-segment') cancelSegmentMove(); if (gesture?.kind === 'resize') cancelResize(); spaceDown = false; syncControls(); });
new ResizeObserver(() => { if (fitOnce && stage.clientWidth > 10) { fitOnce = false; initialView(); } else syncView(); }).observe(stage);

render({ preserveRoutes: true }); saveLocal();
requestAnimationFrame(initialView);
$('#status-message').textContent = 'Drag to arrange · click a conductor and a channel to connect · scroll to zoom';
if (labelsResized) notify('All device labels set to 210 × 60 px');
