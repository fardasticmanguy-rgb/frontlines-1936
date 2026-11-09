export function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createValueNoise(rng, columns, rows, width, height) {
  const stride = columns + 1;
  const grid = Array.from({ length: stride * (rows + 1) }, () => rng());
  const at = (x, y) => grid[y * stride + x];

  return (x, y) => {
    const fx = (x / width) * columns;
    const fy = (y / height) * rows;
    const ix = Math.min(columns - 1, Math.floor(fx));
    const iy = Math.min(rows - 1, Math.floor(fy));
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 1e9);
}
