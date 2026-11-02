// Keep schedule navigation independent of rendering and project mutation.
const nodeIdOfPort = endpoint => {
  if (typeof endpoint !== 'string') return null;
  const separator = endpoint.indexOf(':');
  return separator > 0 ? endpoint.slice(0, separator) : null;
};

function connectionGraph(nodes, wires) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const modules = new Set(nodes.filter(node => node.kind === 'module').map(node => node.id));
  const adjacent = new Map();
  const add = (nodeId, port, other) => {
    if (!adjacent.has(nodeId)) adjacent.set(nodeId, []);
    adjacent.get(nodeId).push({ port, other });
  };
  for (const wire of wires) {
    const from = nodeIdOfPort(wire.from), to = nodeIdOfPort(wire.to);
    if (!byId.has(from) || !byId.has(to)) continue;
    add(from, wire.from, wire.to); add(to, wire.to, wire.from);
  }
  return { byId, modules, adjacent };
}

/** Follow wires through inline labels only; hardware bodies and tags are endpoints. */
function physicalConnections(nodeId, graph, onlyPort = null) {
  const pending = (graph.adjacent.get(nodeId) || []).filter(edge => !onlyPort || edge.port === onlyPort).map(edge => edge.other);
  const connected = new Set(), visitedLabels = new Set([nodeId]);
  while (pending.length) {
    const endpoint = pending.pop(), id = nodeIdOfPort(endpoint), node = graph.byId.get(id);
    if (!node || id === nodeId) continue;
    connected.add(id);
    if (node.kind !== 'wire-label' || visitedLabels.has(id) || ![`${id}:left`, `${id}:right`].includes(endpoint)) continue;
    visitedLabels.add(id);
    for (const edge of graph.adjacent.get(id) || []) {
      if (edge.port === `${id}:left` || edge.port === `${id}:right`) pending.push(edge.other);
    }
  }
  return connected;
}

const uniqueModule = modules => modules.size === 1 ? modules.values().next().value : null;
const assignedModule = (node, graph) => graph.modules.has(node.assignment?.moduleId) ? node.assignment.moduleId : null;

function deviceModuleId(node, graph) {
  const assignment = assignedModule(node, graph);
  if (assignment) return assignment;
  return uniqueModule(new Set([...physicalConnections(node.id, graph)].filter(id => graph.modules.has(id))));
}

/** Resolve local modules without crossing hardware bodies or virtual tag groups. */
export function scheduleModuleIdForNode(node, project) {
  if (!node) return null;
  if (node.kind === 'module') return node.id;
  if (!['device', 'tag', 'wire-label'].includes(node.kind)) return null;
  const nodes = project?.nodes || [], wires = project?.wires || [];
  const graph = connectionGraph(nodes, wires);
  if (node.kind === 'device') return deviceModuleId(node, graph);

  const connected = physicalConnections(node.id, graph), localModules = new Set([...connected].filter(id => graph.modules.has(id)));
  if (node.kind === 'wire-label' && localModules.size) return uniqueModule(localModules);
  const direct = new Set((graph.adjacent.get(node.id) || []).map(edge => nodeIdOfPort(edge.other)));
  for (const id of connected) {
    const neighbor = graph.byId.get(id);
    if (neighbor?.kind === 'module') localModules.add(neighbor.id);
    else if (neighbor?.kind === 'device') {
      // Preserve direct tag-to-device navigation. Inline chains may use an
      // explicit assignment, but never infer continuity through another lead.
      const moduleId = node.kind === 'tag' && direct.has(id) ? deviceModuleId(neighbor, graph) : assignedModule(neighbor, graph);
      if (moduleId) localModules.add(moduleId);
    }
  }
  return uniqueModule(localModules);
}

/** Module first, then its local hardware and annotations in project order. */
export function focusNodesForModule(moduleId, project) {
  const nodes = project?.nodes || [];
  const module = nodes.find(n => n.kind === 'module' && n.id === moduleId);
  if (!module) return [];
  const graph = connectionGraph(nodes, project?.wires || []);
  const included = new Set([moduleId, ...physicalConnections(moduleId, graph)]);
  for (const node of nodes) {
    if (node.kind === 'device' && node.assignment?.moduleId === moduleId) included.add(node.id);
  }
  for (const device of nodes.filter(n => n.kind === 'device' && included.has(n.id))) {
    const ports = new Set((graph.adjacent.get(device.id) || []).map(edge => edge.port));
    for (const port of ports) {
      const branch = physicalConnections(device.id, graph, port);
      const reachesOtherHardware = [...branch].some(id => {
        const kind = graph.byId.get(id)?.kind;
        return kind === 'device' || (kind === 'module' && id !== moduleId);
      });
      if (reachesOtherHardware) continue;
      for (const id of branch) {
        if (['tag', 'wire-label'].includes(graph.byId.get(id)?.kind)) included.add(id);
      }
    }
  }
  // A device's other conductors may keep their local tags and inline labels,
  // but cannot pull in another module or device through that label's body.
  return [module, ...nodes.filter(n => n.id !== moduleId && included.has(n.id))];
}
