/** Draw every crossing, reducing bridge widths where lanes or bends are close. */
export function routePath(points, crossings = []) {
  if (!points?.length) return '';
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], horizontal = Math.abs(a.y - b.y) < .01, vertical = Math.abs(a.x - b.x) < .01;
    const length = Math.hypot(b.x - a.x, b.y - a.y), dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
    const cross = (horizontal || vertical) ? crossings.filter(p => horizontal
      ? Math.abs(p.y - a.y) < .5 && p.x > Math.min(a.x, b.x) && p.x < Math.max(a.x, b.x)
      : Math.abs(p.x - a.x) < .5 && p.y > Math.min(a.y, b.y) && p.y < Math.max(a.y, b.y))
      .map(p => ({ ...p, distance: Math.hypot(p.x - a.x, p.y - a.y) }))
      .sort((p, q) => p.distance - q.distance)
      .filter((p, index, all) => !index || Math.abs(p.distance - all[index - 1].distance) > .01) : [];
    for (let j = 0; j < cross.length; j++) {
      const p = cross[j], dist = p.distance;
      const radius = Math.min(6, dist, length - dist,
        j ? (dist - cross[j - 1].distance) / 2 : Infinity,
        j + 1 < cross.length ? (cross[j + 1].distance - dist) / 2 : Infinity);
      d += horizontal ? ` L${p.x - dx * radius} ${p.y} Q${p.x} ${p.y - 10} ${p.x + dx * radius} ${p.y}` : ` L${p.x} ${p.y - dy * radius} Q${p.x - 10} ${p.y} ${p.x} ${p.y + dy * radius}`;
    }
    d += ` L${b.x} ${b.y}`;
  }
  return d;
}
