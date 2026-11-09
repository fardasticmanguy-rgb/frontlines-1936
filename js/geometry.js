export function distanceSquared(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function clipHalfPlane(polygon, mx, my, nx, ny) {
  const result = [];
  for (let k = 0; k < polygon.length; k++) {
    const a = polygon[k];
    const b = polygon[(k + 1) % polygon.length];
    const da = (a[0] - mx) * nx + (a[1] - my) * ny;
    const db = (b[0] - mx) * nx + (b[1] - my) * ny;
    if (da <= 0) result.push(a);
    if (da <= 0 !== db <= 0) {
      const t = da / (da - db);
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return result;
}

export function voronoiCell(points, index, width, height) {
  const [px, py] = points[index];
  let cell = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];

  const byDistance = points
    .map((p, j) => [distanceSquared(p[0], p[1], px, py), j])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  for (const [d2, j] of byDistance) {
    if (j === index) continue;
    let reach = 0;
    for (const v of cell) reach = Math.max(reach, distanceSquared(v[0], v[1], px, py));
    if (d2 > 4 * reach) break;
    const [qx, qy] = points[j];
    cell = clipHalfPlane(cell, (px + qx) / 2, (py + qy) / 2, qx - px, qy - py);
  }
  return cell;
}

export function centroid(polygon) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let k = 0; k < polygon.length; k++) {
    const p = polygon[k];
    const q = polygon[(k + 1) % polygon.length];
    const cross = p[0] * q[1] - q[0] * p[1];
    area += cross;
    cx += (p[0] + q[0]) * cross;
    cy += (p[1] + q[1]) * cross;
  }
  if (Math.abs(area) < 1e-9) return polygon[0].slice();
  return [cx / (3 * area), cy / (3 * area)];
}

export function pointInPolygon(polygon, x, y) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}
