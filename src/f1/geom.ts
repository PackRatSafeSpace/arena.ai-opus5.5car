import * as THREE from "three";

/* ------------------------------------------------------------------ */
/*  Smooth 1D keyframe interpolation (monotone cubic / Fritsch–Carlson) */
/* ------------------------------------------------------------------ */
export type Key = [number, number];

export function keyed(input: Key[]): (x: number) => number {
  const k = [...input].sort((a, b) => a[0] - b[0]);
  const n = k.length;
  const xs = k.map((p) => p[0]);
  const ys = k.map((p) => p[1]);
  const d: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0] ?? 0;
  m[n - 1] = d[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1]);
      const w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1]);
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * m[i + 1]
    );
  };
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Evenly spaced parameter values with optional clustering toward both ends. */
export function stations(a: number, b: number, n: number, endCluster = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let t = i / (n - 1);
    if (endCluster > 0) t = lerp(t, 0.5 - 0.5 * Math.cos(Math.PI * t), endCluster);
    out.push(lerp(a, b, t));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Sections                                                           */
/* ------------------------------------------------------------------ */

/** Sample a closed centripetal Catmull-Rom through control points (uniform per segment,
 *  so that sections with the same control-point count correspond point-to-point). */
export function smoothRing(ctrl: THREE.Vector3[], n: number): THREE.Vector3[] {
  const curve = new THREE.CatmullRomCurve3(ctrl, true, "centripetal");
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) out.push(curve.getPoint(i / n));
  return out;
}

/** Symmetric (about z=0) section from a half-profile listed bottom-centre -> top-centre on +z side.
 *  First and last points must have z = 0. Result is a closed smooth ring. */
export function mirroredRing(half: THREE.Vector3[], n: number): THREE.Vector3[] {
  const full = [...half];
  for (let i = half.length - 2; i >= 1; i--) {
    const p = half[i];
    full.push(new THREE.Vector3(p.x, p.y, -p.z));
  }
  return smoothRing(full, n);
}

/** Cambered airfoil in local chord coords, u:0 (LE) -> 1 (TE), v up. Closed loop TE(upper)->LE->TE(lower). */
export function airfoil(n: number, thick = 0.1, camber = 0.05, camberPos = 0.45, teThick = 0.012): [number, number][] {
  const half = Math.floor(n / 2);
  const pts: [number, number][] = [];
  const at = (u: number) => {
    const yt =
      5 * thick * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4) +
      teThick * 0.5 * u;
    let yc: number, dyc: number;
    const p = camberPos, m = camber;
    if (u < p) {
      yc = (m / (p * p)) * (2 * p * u - u * u);
      dyc = ((2 * m) / (p * p)) * (p - u);
    } else {
      yc = (m / ((1 - p) ** 2)) * (1 - 2 * p + 2 * p * u - u * u);
      dyc = ((2 * m) / ((1 - p) ** 2)) * (p - u);
    }
    const th = Math.atan(dyc);
    return { yt, yc, th };
  };
  for (let i = 0; i <= half; i++) {
    const u = 0.5 - 0.5 * Math.cos(Math.PI * (1 - i / half)); // TE -> LE
    const { yt, yc, th } = at(u);
    pts.push([u - yt * Math.sin(th), yc + yt * Math.cos(th)]);
  }
  for (let i = 1; i < half; i++) {
    const u = 0.5 - 0.5 * Math.cos(Math.PI * (i / half)); // LE -> TE
    const { yt, yc, th } = at(u);
    pts.push([u + yt * Math.sin(th), yc - yt * Math.cos(th)]);
  }
  return pts;
}

/** Rounded rectangle / superellipse section in a local (a,b) plane. */
export function superEllipse(n: number, a: number, b: number, p = 4): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    out.push([a * Math.sign(c) * Math.abs(c) ** (2 / p), b * Math.sign(s) * Math.abs(s) ** (2 / p)]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Loft                                                               */
/* ------------------------------------------------------------------ */
export interface LoftOptions {
  capStart?: boolean;
  capEnd?: boolean;
  /** extra per-vertex float attribute (same layout as rings) */
  attr?: { name: string; values: number[][] };
  uvScale?: number;
}

/** Build a watertight-ish skinned surface through closed rings of equal length. Normals are
 *  computed analytically on the (wrapping) grid, so there are no seam artefacts. */
export function loft(rings: THREE.Vector3[][], opt: LoftOptions = {}): THREE.BufferGeometry {
  const S = rings.length;
  const N = rings[0].length;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const extra: number[] = [];
  const idx: number[] = [];

  // arc-length UVs (metres * uvScale)
  const us: number[] = [0];
  for (let i = 1; i < S; i++) {
    let d = 0;
    for (let j = 0; j < N; j++) d += rings[i][j].distanceTo(rings[i - 1][j]);
    us.push(us[i - 1] + d / N);
  }
  const vs: number[][] = rings.map((r) => {
    const a = [0];
    for (let j = 1; j <= N; j++) a.push(a[j - 1] + r[j % N].distanceTo(r[j - 1]));
    return a;
  });
  const sc = opt.uvScale ?? 1;

  // orientation check (normals should point away from ring centroid)
  const du = new THREE.Vector3(), dv = new THREE.Vector3(), n = new THREE.Vector3();
  const normals: THREE.Vector3[][] = [];
  let outward = 0;
  for (let i = 0; i < S; i++) {
    const c = new THREE.Vector3();
    rings[i].forEach((p) => c.add(p));
    c.divideScalar(N);
    const row: THREE.Vector3[] = [];
    for (let j = 0; j < N; j++) {
      const a = rings[Math.max(0, i - 1)][j], b = rings[Math.min(S - 1, i + 1)][j];
      du.subVectors(b, a);
      dv.subVectors(rings[i][(j + 1) % N], rings[i][(j - 1 + N) % N]);
      n.crossVectors(dv, du);
      if (n.lengthSq() < 1e-14) n.subVectors(rings[i][j], c);
      n.normalize();
      row.push(n.clone());
      outward += n.dot(rings[i][j].clone().sub(c));
    }
    normals.push(row);
  }
  const flip = outward < 0;

  // side vertices: N+1 per ring (seam duplicated for UVs, same normal)
  for (let i = 0; i < S; i++) {
    for (let j = 0; j <= N; j++) {
      const p = rings[i][j % N];
      const nn = normals[i][j % N];
      pos.push(p.x, p.y, p.z);
      if (flip) nor.push(-nn.x, -nn.y, -nn.z);
      else nor.push(nn.x, nn.y, nn.z);
      uv.push(us[i] * sc, vs[i][j] * sc);
      if (opt.attr) extra.push(opt.attr.values[i][j % N]);
    }
  }
  const W = N + 1;
  for (let i = 0; i < S - 1; i++) {
    for (let j = 0; j < N; j++) {
      const a = i * W + j, b = (i + 1) * W + j, c = (i + 1) * W + j + 1, d = i * W + j + 1;
      // winding must agree with n = dv x du (i.e. triangle (a, d, b) when not flipped)
      if (flip) idx.push(a, b, d, b, c, d);
      else idx.push(a, d, b, b, d, c);
    }
  }

  const cap = (ri: number, end: boolean) => {
    const r = rings[ri];
    const c = new THREE.Vector3();
    r.forEach((p) => c.add(p));
    c.divideScalar(N);
    const other = rings[end ? ri - 1 : ri + 1];
    const oc = new THREE.Vector3();
    other.forEach((p) => oc.add(p));
    oc.divideScalar(N);
    const cn = c.clone().sub(oc).normalize();
    const base = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    nor.push(cn.x, cn.y, cn.z);
    uv.push(0, 0);
    if (opt.attr) extra.push(opt.attr.values[ri][0]);
    for (let j = 0; j < N; j++) {
      const p = r[j];
      pos.push(p.x, p.y, p.z);
      nor.push(cn.x, cn.y, cn.z);
      uv.push((p.x - c.x) * sc, (p.y - c.y + p.z - c.z) * sc);
      if (opt.attr) extra.push(opt.attr.values[ri][j]);
    }
    // winding: determine with a test triangle
    const t = new THREE.Vector3().crossVectors(r[1].clone().sub(c), r[0].clone().sub(c));
    const rev = t.dot(cn) < 0;
    for (let j = 0; j < N; j++) {
      const a = base + 1 + j, b = base + 1 + ((j + 1) % N);
      if (rev) idx.push(base, a, b);
      else idx.push(base, b, a);
    }
  };
  if (opt.capStart) cap(0, false);
  if (opt.capEnd) cap(S - 1, true);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (opt.attr) g.setAttribute(opt.attr.name, new THREE.Float32BufferAttribute(extra, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Scale each ring toward its centroid with an elliptical profile near the ends so lofts close with
 *  a rounded, tangent-continuous nose instead of a flat cap. */
export function roundEnds(rings: THREE.Vector3[][], startFrac: number, endFrac: number, minScale = 0.04) {
  const S = rings.length;
  return rings.map((r, i) => {
    const t = i / (S - 1);
    let s = 1;
    if (startFrac > 0 && t < startFrac) {
      const q = 1 - t / startFrac;
      s = Math.sqrt(Math.max(0, 1 - q * q));
    }
    if (endFrac > 0 && t > 1 - endFrac) {
      const q = (t - (1 - endFrac)) / endFrac;
      s = Math.min(s, Math.sqrt(Math.max(0, 1 - q * q)));
    }
    s = Math.max(minScale, s);
    const c = new THREE.Vector3();
    r.forEach((p) => c.add(p));
    c.divideScalar(r.length);
    return r.map((p) => p.clone().sub(c).multiplyScalar(s).add(c));
  });
}

/* ------------------------------------------------------------------ */
/*  Sweeps                                                             */
/* ------------------------------------------------------------------ */

/** Sweep a 2D section along a polyline/curve path. `section(t)` returns local [a,b] pairs where
 *  a is along `side(t)` direction and b along the resulting binormal. */
export function sweep(
  path: THREE.Vector3[],
  section: (t: number) => [number, number][],
  refUp: THREE.Vector3 = new THREE.Vector3(0, 1, 0),
  opt: LoftOptions = {}
): THREE.BufferGeometry {
  const rings: THREE.Vector3[][] = [];
  const S = path.length;
  for (let i = 0; i < S; i++) {
    const t = i / (S - 1);
    const tan = path[Math.min(S - 1, i + 1)].clone().sub(path[Math.max(0, i - 1)]).normalize();
    let side = new THREE.Vector3().crossVectors(tan, refUp);
    if (side.lengthSq() < 1e-6) side = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(1, 0, 0));
    side.normalize();
    const up = new THREE.Vector3().crossVectors(side, tan).normalize();
    const sec = section(t);
    rings.push(sec.map(([a, b]) => path[i].clone().addScaledVector(side, a).addScaledVector(up, b)));
  }
  return loft(rings, opt);
}

/** Faired suspension member between two points: elliptical/aero section whose major axis is aligned to
 *  the airflow (world X) projected perpendicular to the member. Ends are rounded. */
export function strut(
  a: THREE.Vector3,
  b: THREE.Vector3,
  major: number,
  minor: number,
  opts: { flow?: THREE.Vector3; seg?: number; round?: boolean; aero?: boolean } = {}
): THREE.BufferGeometry {
  const flow = opts.flow ?? new THREE.Vector3(1, 0, 0);
  const t = b.clone().sub(a).normalize();
  let m = flow.clone().addScaledVector(t, -flow.dot(t));
  if (m.lengthSq() < 1e-6) m = new THREE.Vector3(0, 1, 0).addScaledVector(t, -t.y);
  m.normalize();
  const w = new THREE.Vector3().crossVectors(t, m).normalize();
  const seg = opts.seg ?? 20;
  const len = a.distanceTo(b);
  const rings: THREE.Vector3[][] = [];
  const endR = Math.min(minor * 0.9, len * 0.2);
  const ts: number[] = [];
  const nr = 5;
  for (let i = 0; i <= nr; i++) ts.push((endR * (1 - Math.cos((i / nr) * Math.PI * 0.5))) / len);
  ts.push(0.5);
  for (let i = nr; i >= 0; i--) ts.push(1 - (endR * (1 - Math.cos((i / nr) * Math.PI * 0.5))) / len);
  ts.forEach((tt, k) => {
    let s = 1;
    if (opts.round !== false) {
      const dEnd = Math.min(tt * len, (1 - tt) * len);
      const q = 1 - Math.min(1, dEnd / endR);
      s = Math.max(0.15, Math.sqrt(1 - q * q));
    }
    if (k === 0 || k === ts.length - 1) s = opts.round === false ? 1 : 0.15;
    const c = a.clone().lerp(b, tt);
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      let ca = Math.cos(th);
      const sb = Math.sin(th);
      // aero: slightly teardrop (blunter leading edge toward +flow)
      if (opts.aero) ca = ca > 0 ? ca : ca * 1.25;
      ring.push(c.clone().addScaledVector(m, ca * major * 0.5 * s).addScaledVector(w, sb * minor * 0.5 * s));
    }
    rings.push(ring);
  });
  return loft(rings, { capStart: true, capEnd: true });
}

/** Round tube along a smooth path (Catmull-Rom through points). */
export function tube(points: THREE.Vector3[], radius: number | ((t: number) => number), seg = 16, steps = 48) {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const path: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) path.push(curve.getPoint(i / steps));
  const rf = typeof radius === "number" ? () => radius : radius;
  const frames = curve.computeFrenetFrames(steps, false);
  const rings = path.map((p, i) => {
    const r = rf(i / steps);
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      ring.push(
        p.clone().addScaledVector(frames.normals[i], Math.cos(th) * r).addScaledVector(frames.binormals[i], Math.sin(th) * r)
      );
    }
    return ring;
  });
  return loft(rings, { capStart: true, capEnd: true });
}

/** Mirror a geometry across z=0 (fixes winding + normals). */
export function mirrorZ(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone();
  m.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, -1));
  const index = m.getIndex();
  if (index) {
    const arr = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const t = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = t;
    }
    index.needsUpdate = true;
  }
  return m;
}

/** Extruded rounded plate from a 2D outline in the XY plane, thickness along Z, centred at z0. */
export function plate(outline: [number, number][], thickness: number, z0: number, bevel = 0.003, curveSeg = 6) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.0005, thickness - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: curveSeg,
  });
  g.translate(0, 0, z0 - (thickness - 2 * bevel) / 2);
  g.computeVertexNormals();
  return g;
}

/** Smooth closed outline through control points (for plates). */
export function smoothOutline(ctrl: [number, number][], n = 80): [number, number][] {
  const c = new THREE.CatmullRomCurve3(ctrl.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, "centripetal");
  return c.getSpacedPoints(n).slice(0, n).map((p) => [p.x, p.y]);
}
