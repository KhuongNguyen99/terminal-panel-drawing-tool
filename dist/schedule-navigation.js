// Keep schedule navigation independent of rendering and project mutation.
const nodeIdOfPort = endpoint => {
  if (typeof endpoint !== 'string') return null;
  const separator = endpoint.indexOf(':');
  return separator > 0 ? endpoint.slice(0, separator) : null;
};

function connectedNodeIds(nodeId, wires) {
  const connected = new Set();
  for (const wire of wires) {
    const from = nodeIdOfPort(wire.from), to = nodeIdOfPort(wire.to);
    if (from === nodeId && to) connected.add(to);
    if (to === nodeId && from) connected.add(from);
  }
  return connected;
}

function deviceModuleId(node, modules, wires) {
  if (modules.has(node.assignment?.moduleId)) return node.assignment.moduleId;
  const connected = new Set([...connectedNodeIds(node.id, wires)].filter(id => modules.has(id)));
  return connected.size === 1 ? connected.values().next().value : null;
}

/** Resolve a label's local module without changing saved assignments or wiring. */
export function scheduleModuleIdForNode(node, project) {
  if (!node) return null;
  if (node.kind === 'module') return node.id;
  if (node.kind !== 'device' && node.kind !== 'tag') return null;
  const nodes = project?.nodes || [], wires = project?.wires || [];
  const modules = new Set(nodes.filter(n => n.kind === 'module').map(n => n.id));
  if (node.kind === 'device') return deviceModuleId(node, modules, wires);

  const byId = new Map(nodes.map(n => [n.id, n])), localModules = new Set();
  for (const id of connectedNodeIds(node.id, wires)) {
    const neighbor = byId.get(id);
    if (neighbor?.kind === 'module') localModules.add(neighbor.id);
    else if (neighbor?.kind === 'device') {
      const moduleId = deviceModuleId(neighbor, modules, wires);
      if (moduleId) localModules.add(moduleId);
    }
  }
  // Matching tag names express a remote connection, not a local slot assignment.
  return localModules.size === 1 ? localModules.values().next().value : null;
}

/** Module first, then its local devices, connected items, and device tags in project order. */
export function focusNodesForModule(moduleId, project) {
  const nodes = project?.nodes || [];
  const module = nodes.find(n => n.kind === 'module' && n.id === moduleId);
  if (!module) return [];
  const wires = project?.wires || [], connected = connectedNodeIds(moduleId, wires);
  const included = new Set([moduleId]);
  for (const node of nodes) {
    const assigned = node.kind === 'device' && node.assignment?.moduleId === moduleId;
    if (assigned || connected.has(node.id)) included.add(node.id);
  }
  const devices = new Set(nodes.filter(n => n.kind === 'device' && included.has(n.id)).map(n => n.id));
  const tags = new Set(nodes.filter(n => n.kind === 'tag').map(n => n.id));
  for (const wire of wires) {
    const from = nodeIdOfPort(wire.from), to = nodeIdOfPort(wire.to);
    if (devices.has(from) && tags.has(to)) included.add(to);
    if (devices.has(to) && tags.has(from)) included.add(from);
  }
  // Do not traverse matching names or neighboring modules: scoped PNGs keep
  // local short wires and references without pulling in the remote network.
  return [module, ...nodes.filter(n => n.id !== moduleId && included.has(n.id))];
}
