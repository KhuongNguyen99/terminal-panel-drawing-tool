// Keep schedule navigation independent of rendering and project mutation.
const nodeIdOfPort = endpoint => {
  if (typeof endpoint !== 'string') return null;
  const separator = endpoint.indexOf(':');
  return separator > 0 ? endpoint.slice(0, separator) : null;
};

/** Resolve a label's module without changing its saved assignment or wiring. */
export function scheduleModuleIdForNode(node, project) {
  if (!node) return null;
  if (node.kind === 'module') return node.id;
  if (node.kind !== 'device') return null;
  const modules = new Set((project?.nodes || []).filter(n => n.kind === 'module').map(n => n.id));
  if (modules.has(node.assignment?.moduleId)) return node.assignment.moduleId;
  const connected = new Set();
  for (const wire of project?.wires || []) {
    const from = nodeIdOfPort(wire.from), to = nodeIdOfPort(wire.to);
    if (from === node.id && modules.has(to)) connected.add(to);
    if (to === node.id && modules.has(from)) connected.add(from);
  }
  return connected.size === 1 ? connected.values().next().value : null;
}

/** Module first, then its assigned or directly connected devices in project order. */
export function focusNodesForModule(moduleId, project) {
  const nodes = project?.nodes || [];
  const module = nodes.find(n => n.kind === 'module' && n.id === moduleId);
  if (!module) return [];
  const connected = new Set();
  for (const wire of project?.wires || []) {
    const from = nodeIdOfPort(wire.from), to = nodeIdOfPort(wire.to);
    if (from === moduleId) connected.add(to);
    if (to === moduleId) connected.add(from);
  }
  const result = [module], included = new Set([moduleId]);
  for (const node of nodes) {
    if (node.kind !== 'device' || included.has(node.id)) continue;
    if (node.assignment?.moduleId !== moduleId && !connected.has(node.id)) continue;
    result.push(node); included.add(node.id);
  }
  return result;
}
