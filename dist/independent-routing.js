import { routeWires } from './router.js';
import { captureManualRoute, resolveManualRoute } from './manual-routing.js';

/**
 * Keep the current bends of existing wires unless the user asks to route them.
 * A saved route uses the same geometry as a manual route without implying that
 * the user edited it. New connections still receive an initial automatic path.
 * Inputs are never mutated; the caller persists the returned savedRoutes.
 */
export function routeWithPreferences({
  wires = [], ports = [], obstacles = [], grid = 10, gap = 10,
  autoRoute = false, preserveRoutes = false, rerouteIds = [], rerouteAll = false,
} = {}) {
  const targets = new Set(rerouteIds);
  const preserve = preserveRoutes || !autoRoute || targets.size > 0;
  const effectiveWires = wires.map(wire => {
    const next = { ...wire };
    if (rerouteAll || targets.has(wire.id)) delete next.manual;
    else {
      const fixed = wire.manual || (preserve ? wire.savedRoute : null);
      if (fixed) next.manual = fixed;
      else delete next.manual;
    }
    return next;
  });
  const result = routeWires({ wires: effectiveWires, ports, obstacles, grid, gap, preserveBlockedRoutes: true });
  const portMap = ports instanceof Map ? ports : new Map(
    Array.isArray(ports) ? ports.map(port => [port.id, port]) : Object.entries(ports),
  );
  const portFor = value => value && typeof value === 'object' ? value : portMap.get(value);
  const savedRoutes = Object.create(null);
  for (const wire of effectiveWires) {
    const route = result.routes[wire.id];
    if (!route) continue;
    if (route.status === 'blocked') {
      // A component can be moved across an existing wire. Keep that wire's
      // geometry visible with its blocked status instead of erasing it or
      // choosing a new route. The caller can show the conflict and reject export.
      if (wire.manual) route.points = resolveManualRoute(wire.manual, portFor(wire.from), portFor(wire.to), { grid, gap }) || [];
      continue;
    }
    const saved = captureManualRoute(route.points, portFor(wire.from), portFor(wire.to));
    if (saved) savedRoutes[wire.id] = saved;
  }
  return { ...result, savedRoutes };
}

export default routeWithPreferences;
