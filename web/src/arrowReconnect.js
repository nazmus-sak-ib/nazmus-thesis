export function closestArrowEnd(point, source, target) {
  return Math.hypot(point.x - source.x, point.y - source.y) <= Math.hypot(point.x - target.x, point.y - target.y) ? 'source' : 'target';
}

export function arrowSnapPoints(node) {
  if (!node) return [];
  const position = node.internals?.positionAbsolute ?? node.position;
  const width = node.measured?.width ?? node.width, height = node.measured?.height ?? node.height;
  if (!position || !Number.isFinite(width) || !Number.isFinite(height)) return [];
  return [ ['left', 0, height / 2], ['right', width, height / 2], ['top', width / 2, 0], ['bottom', width / 2, height] ]
    .map(([side, x, y]) => ({ side, handle: 'source-' + side, x: position.x + x, y: position.y + y }));
}

export function snapArrowEndpoint(point, points, zoom = 1) {
  if (!points.length) return null;
  const margin = 48 / zoom;
  if (point.x < Math.min(...points.map(p=>p.x)) - margin || point.x > Math.max(...points.map(p=>p.x)) + margin ||
      point.y < Math.min(...points.map(p=>p.y)) - margin || point.y > Math.max(...points.map(p=>p.y)) + margin) return null;
  return points.reduce((best, p) => Math.hypot(point.x-p.x,point.y-p.y) < Math.hypot(point.x-best.x,point.y-best.y) ? p : best);
}

export function reattachArrow(edge, end, point) {
  return point ? { ...edge, [end === 'source' ? 'sourceHandle' : 'targetHandle']: point.handle } : edge;
}
