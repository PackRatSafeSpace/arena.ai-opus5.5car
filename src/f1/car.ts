import * as THREE from "three";
import {
  keyed, smoothstep, lerp, V, stations, mirroredRing, smoothRing, loft, roundEnds, airfoil, superEllipse,
  sweep, strut, tube, mirrorZ, plate, smoothOutline,
} from "./geom";
import type { Materials } from "./materials";

/*
 * ARC-26 — an original 2022–2025 ground-effect-era Formula 1 car.
 * Units: metres. +X forward, +Y up, Z lateral. Front axle X=+1.8, rear axle X=-1.8 (3.6 m wheelbase).
 * Tyres 720 mm on 18" rims, overall width 2.0 m, airbox height ~0.95 m.
 */
export const XF = 1.8;
export const XR = -1.8;
export const WHEEL_R = 0.36;
const FRONT_TRACK_Z = 0.79;
const REAR_TRACK_Z = 0.795;
const FRONT_W = 0.305;
const REAR_W = 0.405;

type Tick = (label: string, frac: number) => Promise<void>;

/** Suspension hard-points (right side). Exposed for verification. */
export const HARDPOINTS = {
  front: {
    UF: V(2.05, 0.405, 0.125), UR: V(1.5, 0.485, 0.18), UO: V(1.79, 0.56, 0.612),
    LF: V(2.1, 0.205, 0.115), LR: V(1.45, 0.205, 0.17), LO: V(1.81, 0.172, 0.662),
    PR_OUT: V(1.808, 0.2, 0.632), PR_IN: V(1.66, 0.5, 0.155),
    TR_OUT: V(1.935, 0.455, 0.622), TR_IN: V(1.985, 0.43, 0.12),
  },
  rear: {
    UF: V(-1.55, 0.43, 0.095), UR: V(-1.99, 0.4, 0.1), UO: V(-1.82, 0.56, 0.568),
    LF: V(-1.52, 0.17, 0.14), LR: V(-2.05, 0.22, 0.12), LO: V(-1.79, 0.175, 0.638),
    PR_OUT: V(-1.8, 0.2, 0.61), PR_IN: V(-1.95, 0.43, 0.085),
    TR_OUT: V(-2.0, 0.34, 0.598), TR_IN: V(-2.06, 0.335, 0.115),
  },
};

/* ------------------------------------------------------------------ */
export async function buildCar(M: Materials, tick: Tick): Promise<THREE.Group> {
  const car = new THREE.Group();
  car.name = "ARC-26";
  const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = car, name = "") => {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    parent.add(mesh);
    return mesh;
  };
  const addSym = (g: THREE.BufferGeometry, m: THREE.Material, name = "") => {
    add(g, m, car, name + "_R");
    add(mirrorZ(g), m, car, name + "_L");
  };
  const cockpitInterior = (p: THREE.Vector3) =>
    p.x > -0.45 && p.x < 0.64 && Math.abs(p.z) < 0.207 && p.y < 0.646 && p.y > 0.22 ? 1 : 0;

  /* ================= CHASSIS + NOSE ================= */
  await tick("Survival cell & nose", 0.08);
  const chTop = keyed([[2.975, 0.2], [2.9, 0.226], [2.7, 0.262], [2.4, 0.325], [2.05, 0.415], [1.7, 0.51], [1.3, 0.585], [0.95, 0.632], [0.7, 0.652], [0.4, 0.658], [-0.4, 0.655]]);
  const chBot = keyed([[2.975, 0.142], [2.85, 0.128], [2.5, 0.126], [2.1, 0.16], [1.78, 0.19], [1.5, 0.165], [1.2, 0.1], [0.95, 0.055], [-0.4, 0.05]]);
  const chHW = keyed([[2.975, 0.066], [2.88, 0.084], [2.6, 0.098], [2.2, 0.118], [1.8, 0.145], [1.4, 0.18], [1.0, 0.215], [0.65, 0.245], [0.3, 0.252], [-0.4, 0.25]]);
  const ckD = (x: number) => smoothstep(0.66, 0.5, x);
  const CK_DEPTH = 0.36;
  {
    const xs = stations(2.975, -0.4, 150, 0.35);
    const rings: THREE.Vector3[][] = [];
    const flags: number[][] = [];
    const NR = 88;
    for (const x of xs) {
      const yt = chTop(x), yb = chBot(x), hw = chHW(x), d = ckD(x);
      const hwIn = Math.min(hw - 0.035, 0.205);
      const crown = 0.02 * (1 - d);
      const cy = (z: number) => yt + crown * (1 - (z / hw) ** 2);
      const top0 = [0.7, 0.47, 0.23, 0].map((f) => [f * hw, cy(f * hw)] as [number, number]);
      const top1: [number, number][] = [
        [hwIn, yt - 0.012], [hwIn - 0.014, yt - CK_DEPTH * 0.55], [hwIn * 0.55, yt - CK_DEPTH], [0, yt - CK_DEPTH],
      ];
      const tops = top0.map((a, i) => V(x, lerp(a[1], top1[i][1], d), lerp(a[0], top1[i][0], d)));
      const half = [
        V(x, yb, 0), V(x, yb, hw * 0.48), V(x, yb + 0.018, hw * 0.8), V(x, yb + (yt - yb) * 0.33, hw * 0.965),
        V(x, yb + (yt - yb) * 0.68, hw), V(x, yt - 0.028, hw * 0.975), V(x, cy(hw * 0.88) - 0.002, hw * 0.88),
        ...tops,
      ];
      let ring = mirroredRing(half, NR);
      // rounded nose tip
      const tipL = 0.075;
      if (x > 2.975 - tipL) {
        const q = (x - (2.975 - tipL)) / tipL;
        const s = Math.max(0.05, Math.sqrt(Math.max(0, 1 - q * q)));
        const c = new THREE.Vector3(x, (yt + yb) / 2, 0);
        ring = ring.map((p) => V(x, c.y + (p.y - c.y) * s, p.z * s));
      }
      rings.push(ring);
      flags.push(ring.map((p) => cockpitInterior(p)));
    }
    const g = loft(rings, { capStart: true, capEnd: true, attr: { name: "interior", values: flags } });
    add(g, M.paint, car, "chassis");
  }

  /* ================= ENGINE COVER / AIRBOX ================= */
  await tick("Engine cover & airbox", 0.16);
  const ecTop = keyed([[-0.12, 0.6], [-0.2, 0.72], [-0.3, 0.86], [-0.39, 0.935], [-0.5, 0.95], [-0.62, 0.928], [-0.9, 0.8], [-1.3, 0.64], [-1.7, 0.54], [-2.04, 0.505]]);
  const ecTopHW = keyed([[-0.12, 0.13], [-0.3, 0.105], [-0.45, 0.088], [-0.7, 0.05], [-1.0, 0.038], [-1.5, 0.045], [-2.04, 0.062]]);
  const ecHW = keyed([[-0.12, 0.245], [-0.5, 0.235], [-0.9, 0.2], [-1.3, 0.165], [-1.7, 0.135], [-2.04, 0.11]]);
  const ecBot = keyed([[-1.45, 0.055], [-1.85, 0.15], [-2.04, 0.2]]);
  {
    const xs = stations(-0.12, -2.04, 120, 0.3);
    let rings = xs.map((x) => {
      const t = ecTop(x), th = ecTopHW(x), hw = ecHW(x), b = ecBot(x);
      const mid = lerp(b, t, 0.36);
      const half = [
        V(x, b, 0), V(x, b, hw * 0.8), V(x, b + 0.04, hw), V(x, mid, hw * 0.985),
        V(x, lerp(mid, t, 0.62), lerp(hw, th, 0.62)), V(x, t - 0.035, th), V(x, t - 0.004, th * 0.5), V(x, t, 0),
      ];
      return mirroredRing(half, 72);
    });
    rings = roundEnds(rings, 0.05, 0, 0.2);
    const flags = rings.map((r, i) => r.map((p) => (i === rings.length - 1 ? 1 : cockpitInterior(p))));
    add(loft(rings, { capStart: true, capEnd: true, attr: { name: "interior", values: flags } }), M.paint, car, "engineCover");

    // airbox intake (rounded triangle), lip + dark plenum
    const tri = (s: number, depth: number) => {
      const pts: [number, number][] = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const r = 1 + 0.16 * Math.cos(3 * a + Math.PI / 2) * 1;
        pts.push([Math.cos(a) * r * 0.07 * s, Math.sin(a) * r * 0.062 * s + depth]);
      }
      return pts;
    };
    const lipRings: THREE.Vector3[][] = [];
    const lipX = [-0.3, -0.296, -0.31, -0.36];
    const lipS = [0.9, 1.0, 1.08, 1.08];
    lipX.forEach((x, i) => lipRings.push(tri(lipS[i], 0).map(([zz, yy]) => V(x, 0.872 + yy, zz))));
    add(loft(lipRings), M.paint, car, "airboxLip");
    const plug = [-0.33, -0.335].map((x) => tri(0.92, 0).map(([zz, yy]) => V(x, 0.872 + yy, zz)));
    add(loft(plug, { capStart: true, capEnd: true }), M.interior, car, "airboxPlenum");

    // T-camera pod on the roll hoop
    const tcam = roundEnds(stations(-0.36, -0.5, 16).map((x) => superEllipse(24, 0.032, 0.02, 3).map(([a, b]) => V(x, 0.968 + b, a))), 0.3, 0.3, 0.15);
    add(loft(tcam, { capStart: true, capEnd: true }), M.blackGloss, car, "tcam");

    // headrest pads in cockpit
    const hr = roundEnds(stations(-0.08, -0.3, 14).map((x) => superEllipse(40, 0.19, 0.06, 5).map(([a, b]) => V(x, 0.6 + b, a))), 0.25, 0, 0.3);
    add(loft(hr, { capStart: true, capEnd: true }), M.interior, car, "headrest");
  }

  /* ================= SIDEPODS ================= */
  await tick("Sculpted sidepods", 0.26);
  {
    const spTop = keyed([[0.46, 0.618], [0.3, 0.636], [0.0, 0.622], [-0.35, 0.565], [-0.7, 0.47], [-1.05, 0.385], [-1.35, 0.325], [-1.64, 0.285]]);
    const spOut = keyed([[0.46, 0.585], [0.3, 0.632], [0.05, 0.648], [-0.35, 0.618], [-0.7, 0.552], [-1.05, 0.45], [-1.35, 0.32], [-1.64, 0.17]]);
    const spSh = keyed([[0.46, 0.53], [0.0, 0.5], [-0.7, 0.41], [-1.64, 0.2]]);
    const spBot = keyed([[0.46, 0.405], [0.28, 0.33], [0.05, 0.19], [-0.3, 0.075], [-1.64, 0.058]]);
    const spUnder = keyed([[0.46, 0.43], [0.2, 0.39], [-0.3, 0.36], [-0.8, 0.33], [-1.3, 0.255], [-1.64, 0.16]]);
    const zIn = keyed([[0.46, 0.16], [-1.0, 0.15], [-1.64, 0.11]]);
    const xs = stations(0.462, -1.64, 110, 0.25);
    const rings = xs.map((x) => {
      const top = spTop(x), out = spOut(x), sh = spSh(x), bot = spBot(x), und = spUnder(x), zi = zIn(x);
      const ctrl = [
        V(x, top - 0.004, zi), V(x, top - 0.006, lerp(zi, out, 0.45)), V(x, top - 0.04, out - 0.05),
        V(x, lerp(top, sh, 0.55), out - 0.004), V(x, sh - 0.03, out - 0.008),
        V(x, lerp(sh, bot, 0.42), lerp(out, und, 0.8)), V(x, bot + 0.018, und), V(x, bot, lerp(und, zi, 0.5)), V(x, bot, zi),
      ];
      const ring = smoothRing(ctrl, 80);
      // raked inlet: top lip overhangs the lower lip
      const shear = 0.3 * smoothstep(0.25, 0.462, x);
      return ring.map((p) => V(p.x + shear * (p.y - 0.5), p.y, p.z));
    });
    // rolled inlet lip
    const lip = rings[0].map((p) => p);
    const c0 = new THREE.Vector3();
    lip.forEach((p) => c0.add(p));
    c0.divideScalar(lip.length);
    const lipRing = (s: number, dx: number) => lip.map((p) => p.clone().sub(c0).multiplyScalar(s).add(c0).add(V(dx, 0, 0)));
    const allRings = [lipRing(0.9, -0.02), lipRing(0.93, 0.0), lipRing(0.975, 0.003), ...rings];
    addSym(loft(allRings, { capEnd: true }), M.paint, "sidepod");
    const plugRings = [lipRing(0.93, -0.06), lipRing(0.93, -0.075)];
    addSym(loft(plugRings, { capStart: true, capEnd: true }), M.interior, "sidepodDuct");
    // radiator vanes visible in the duct
    for (let k = 0; k < 5; k++) {
      const y = 0.435 + k * 0.035;
      addSym(strut(V(0.4, y, 0.2), V(0.4, y, 0.58), 0.02, 0.004, { round: false }), M.titanium, "radVane");
    }
  }

  /* ================= FLOOR ================= */
  await tick("Floor, tunnels & diffuser", 0.36);
  {
    const half: [number, number][] = [
      [0.95, 0.0], [0.95, 0.4], [0.9, 0.56], [0.72, 0.68], [0.45, 0.77], [0.1, 0.845], [-0.35, 0.9], [-0.9, 0.915],
      [-1.18, 0.9], [-1.32, 0.855], [-1.4, 0.74], [-1.43, 0.62], [-1.52, 0.565], [-1.64, 0.555],
    ];
    const outline: [number, number][] = [...half, ...half.slice(1).reverse().map(([x, z]) => [x, -z] as [number, number])];
    const g = plate(outline, 0.024, 0, 0.006, 8);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0.042, 0);
    add(g, M.carbonMatte, car, "floor");
    // plank
    const pl = plate([[0.9, 0.15], [-1.6, 0.15], [-1.6, -0.15], [0.9, -0.15]], 0.012, 0, 0.003, 2);
    pl.rotateX(Math.PI / 2);
    pl.translate(0, 0.025, 0);
    add(pl, M.interior, car, "plank");

    // floor edge wing (upturned lip)
    const edge = keyed([[0.35, 0.8], [0.0, 0.855], [-0.4, 0.895], [-0.9, 0.905], [-1.12, 0.89]]);
    const path = stations(0.35, -1.12, 40).map((x) => V(x, 0.056, edge(x) - 0.012));
    const foil = airfoil(24, 0.12, 0.08, 0.4, 0.03);
    const eg = sweep(path, (t) => {
      const c = 0.07 * (0.6 + 0.4 * Math.sin(Math.PI * t));
      const a = (-55 * Math.PI) / 180;
      return foil.map(([u, v]) => {
        const lu = u * c, lv = -v * c;
        return [lu * Math.cos(a) - lv * Math.sin(a), -(lu * Math.sin(a) + lv * Math.cos(a))] as [number, number];
      });
    }, V(0, 1, 0), { capStart: true, capEnd: true });
    addSym(eg, M.carbon, "floorEdgeWing");

    // floor stay
    addSym(strut(V(-0.62, 0.056, 0.87), V(-0.5, 0.3, 0.46), 0.026, 0.008, { aero: true }), M.titanium, "floorStay");

    // tunnel inlet roof (floor leading edge "bib") and fences
    const roofY = (x: number) => 0.052 + 0.1 * smoothstep(0.8, 1.26, x);
    const roofZ = keyed([[0, 0.0], [1, 0.62]]);
    const roofRings = stations(-1, 1, 60).map((s) => {
      const z = roofZ(Math.abs(s)) * Math.sign(s);
      const centre = stations(1.27, 0.78, 20).map((x) => [x, roofY(x) + 0.018 * (1 - Math.abs(s)) * smoothstep(0.8, 1.2, x)] as [number, number]);
      return thickCurve(centre, 0.006).map(([x, y]) => V(x, y, z));
    });
    add(loft(roofRings, { capStart: true, capEnd: true, uvScale: 1 }), M.carbon, car, "tunnelRoof");
    [0.13, 0.25, 0.37, 0.49].forEach((z, i) => {
      const x0 = 1.24 - i * 0.012, x1 = 0.72;
      const out: [number, number][] = [];
      for (let k = 0; k <= 12; k++) {
        const x = lerp(x0, x1, k / 12);
        out.push([x, roofY(x) + 0.01]);
      }
      out.push([x1, 0.03], [x0 - 0.02, 0.03], [x0 + 0.005, 0.07]);
      const fg = plate(smoothOutline(out, 60), 0.008, 0, 0.002, 4);
      fg.rotateY(-0.12 * (i + 1) * 0.35);
      fg.translate(0, 0, z);
      addSym(fg, M.carbon, "floorFence");
    });
  }

  /* ================= DIFFUSER ================= */
  {
    const roof = (x: number) => 0.045 + 0.27 * smoothstep(-1.5, -2.3, x) ** 1.3;
    const rings = stations(-1, 1, 50).map((s) => {
      const z = s * 0.535;
      const centre = stations(-1.5, -2.3, 30).map((x) => [x, roof(x)] as [number, number]);
      return thickCurve(centre, 0.006).map(([x, y]) => V(x, y, z));
    });
    add(loft(rings, { capStart: true, capEnd: true }), M.carbonMatte, car, "diffuserRoof");
    const fence = (z: number, h0: number) => {
      const out: [number, number][] = [];
      for (let k = 0; k <= 14; k++) {
        const x = lerp(-1.5, -2.3, k / 14);
        out.push([x, roof(x) + 0.005]);
      }
      out.push([-2.3, h0], [-1.8, 0.03], [-1.52, 0.035]);
      const g = plate(smoothOutline(out, 70), 0.009, z, 0.002, 4);
      return g;
    };
    addSym(fence(0.53, 0.04), M.carbonMatte, "diffuserOuter");
    addSym(fence(0.36, 0.06), M.carbonMatte, "diffuserStrake");
    addSym(fence(0.19, 0.07), M.carbonMatte, "diffuserStrake");
    // diffuser trailing flap (gurney-like lip)
    const lipR = stations(-1, 1, 30).map((s) => superEllipse(16, 0.012, 0.004, 2.5).map(([a, b]) => V(-2.305 + a, roof(-2.3) + 0.012 + b, s * 0.53)));
    add(loft(lipR, { capStart: true, capEnd: true }), M.carbon, car, "diffuserLip");
  }

  /* ================= GEARBOX / CRASH STRUCTURE / EXHAUST ================= */
  await tick("Gearbox, crash structure, exhaust", 0.44);
  {
    const gbHW = keyed([[-1.35, 0.14], [-1.8, 0.13], [-2.1, 0.11], [-2.46, 0.065]]);
    const gbY = keyed([[-1.35, 0.26], [-2.05, 0.28], [-2.46, 0.35]]);
    const gbH = keyed([[-1.35, 0.14], [-2.05, 0.13], [-2.2, 0.085], [-2.46, 0.055]]);
    let rings = stations(-1.35, -2.46, 50).map((x) => superEllipse(40, gbHW(x), gbH(x), 3.2).map(([a, b]) => V(x, gbY(x) + b, a)));
    rings = roundEnds(rings, 0, 0.04, 0.5);
    add(loft(rings, { capStart: true, capEnd: true }), M.carbon, car, "gearboxCrash");
    // rain light
    const rl = plate(smoothOutline([[0.03, 0.018], [-0.03, 0.018], [-0.03, -0.018], [0.03, -0.018]], 24), 0.01, 0, 0.003, 4);
    rl.rotateY(Math.PI / 2);
    rl.translate(-2.462, 0.35, 0);
    add(rl, M.rainLight, car, "rainLight");
    // exhaust
    const ex = tube([V(-1.9, 0.47, 0), V(-2.05, 0.472, 0), V(-2.2, 0.478, 0)], (t) => 0.043 - 0.004 * t, 36, 12);
    add(ex, M.exhaust, car, "exhaust");
    const exIn = tube([V(-2.12, 0.478, 0), V(-2.199, 0.478, 0)], 0.034, 36, 2);
    add(exIn, M.interior, car, "exhaustInner");
  }

  /* ================= FRONT WING ================= */
  await tick("Four-element front wing", 0.52);
  {
    interface El { c: number; a: number; lx: number; ly: number }
    const stack = (s: number): El[] => {
      const r = Math.abs(s);
      const out: El[] = [];
      const mc = keyed([[0, 0.3], [0.25, 0.3], [0.5, 0.27], [0.9, 0.24]])(r);
      const ma = (keyed([[0, 3], [0.25, 3], [0.5, 6], [0.9, 8]])(r) * Math.PI) / 180;
      const mx = 2.955 - 0.045 * smoothstep(0.2, 0.9, r);
      const my = keyed([[0, 0.108], [0.22, 0.104], [0.42, 0.078], [0.65, 0.08], [0.9, 0.098]])(r);
      out.push({ c: mc, a: ma, lx: mx, ly: my });
      const chords = [keyed([[0, 0.16], [0.5, 0.15], [0.9, 0.13]]), keyed([[0, 0.14], [0.9, 0.12]]), keyed([[0, 0.13], [0.9, 0.105]])];
      const base = [12, 19, 26], extra = [8, 14, 20];
      for (let k = 0; k < 3; k++) {
        const p = out[k];
        const dcx = -Math.cos(p.a), dcy = Math.sin(p.a);
        const nx = Math.sin(p.a), ny = Math.cos(p.a);
        const tex = p.lx + dcx * p.c, tey = p.ly + dcy * p.c;
        const lx = tex - dcx * 0.03 + nx * 0.012, ly = tey - dcy * 0.03 + ny * 0.012;
        const a = ((base[k] + extra[k] * smoothstep(0.35, 0.88, r)) * Math.PI) / 180;
        out.push({ c: chords[k](r), a, lx, ly });
      }
      return out;
    };
    const zs = stations(-0.9, 0.9, 121);
    const stacks = zs.map((z) => stack(z));
    for (let k = 0; k < 4; k++) {
      const foil = airfoil(44, k === 0 ? 0.075 : 0.085, k === 0 ? 0.05 : 0.07, 0.4, 0.018);
      const rings = zs.map((z, i) => {
        const e = stacks[i][k];
        const dcx = -Math.cos(e.a), dcy = Math.sin(e.a), nx = Math.sin(e.a), ny = Math.cos(e.a);
        return foil.map(([u, v]) => V(e.lx + (u * dcx - v * nx) * e.c, e.ly + (u * dcy - v * ny) * e.c, z));
      });
      add(loft(rings, { capStart: true, capEnd: true }), k >= 2 ? M.ivory : M.carbon, car, "frontWing" + k);
    }
    // endplates
    const ep = smoothOutline([
      [2.965, 0.07], [2.985, 0.14], [2.94, 0.215], [2.8, 0.27], [2.62, 0.335], [2.5, 0.36], [2.46, 0.33],
      [2.47, 0.2], [2.52, 0.09], [2.6, 0.058], [2.8, 0.056],
    ], 90);
    const epg = plate(ep, 0.012, 0.905, 0.004, 6);
    addSym(epg, M.ink, "frontEndplate");
    // endplate footplate / lower strake
    const fp = strut(V(2.97, 0.062, 0.89), V(2.52, 0.062, 0.86), 0.004, 0.035, { round: true });
    addSym(fp, M.carbon, "frontFootplate");
    // painted endplate top edge accent
    const acc = tube(ep.filter(([x, y]) => y > 0.2 && x > 2.47).map(([x, y]) => V(x, y + 0.0015, 0.905)), 0.0065, 10, 60);
    addSym(acc, M.vermilion, "frontEndplateAccent");
  }

  /* ================= REAR WING + BEAM WING ================= */
  await tick("Rear wing & beam wing", 0.6);
  {
    const zs = stations(-0.495, 0.495, 91);
    const mk = (defs: { c: (r: number) => number; a: (r: number) => number; le: (r: number) => [number, number]; t: number; cam: number }) => {
      const foil = airfoil(48, defs.t, defs.cam, 0.4, 0.016);
      const rings = zs.map((z) => {
        const r = Math.abs(z);
        const c = defs.c(r), a = defs.a(r), [lx, ly] = defs.le(r);
        const dcx = -Math.cos(a), dcy = Math.sin(a), nx = Math.sin(a), ny = Math.cos(a);
        return foil.map(([u, v]) => V(lx + (u * dcx - v * nx) * c, ly + (u * dcy - v * ny) * c, z));
      });
      return loft(rings, { capStart: true, capEnd: true });
    };
    const deg = Math.PI / 180;
    const mainC = (r: number) => 0.24 - 0.012 * (r / 0.5);
    const mainA = (r: number) => (10 + 3 * smoothstep(0.2, 0.49, r)) * deg;
    const mainLE = (r: number): [number, number] => [-2.3, 0.705 + 0.035 * smoothstep(0.1, 0.49, r) ** 2];
    add(mk({ c: mainC, a: mainA, le: mainLE, t: 0.1, cam: 0.06 }), M.carbon, car, "rearMain");
    const flapLE = (r: number): [number, number] => {
      const c = mainC(r), a = mainA(r), [lx, ly] = mainLE(r);
      return [lx - Math.cos(a) * c + Math.cos(a) * 0.028 + Math.sin(a) * 0.012, ly + Math.sin(a) * c - Math.sin(a) * 0.028 + Math.cos(a) * 0.012];
    };
    add(mk({ c: (r) => 0.19 - 0.01 * (r / 0.5), a: (r) => (38 + 4 * smoothstep(0.2, 0.49, r)) * deg, le: flapLE, t: 0.1, cam: 0.08 }), M.ivory, car, "rearFlap");
    // beam wing
    const bLE = (): [number, number] => [-2.3, 0.335];
    add(mk({ c: () => 0.12, a: () => 8 * deg, le: bLE, t: 0.11, cam: 0.05 }), M.carbon, car, "beamLower");
    const bUpLE = (): [number, number] => {
      const a = 8 * deg;
      return [-2.3 - Math.cos(a) * 0.12 + Math.cos(a) * 0.025 + Math.sin(a) * 0.012, 0.335 + Math.sin(a) * 0.12 - Math.sin(a) * 0.025 + Math.cos(a) * 0.014];
    };
    add(mk({ c: () => 0.1, a: () => 24 * deg, le: bUpLE, t: 0.11, cam: 0.06 }), M.carbon, car, "beamUpper");
    // endplates
    const ep = smoothOutline([
      [-2.265, 0.6], [-2.245, 0.76], [-2.275, 0.895], [-2.38, 0.95], [-2.56, 0.953], [-2.685, 0.93], [-2.715, 0.85],
      [-2.68, 0.66], [-2.6, 0.52], [-2.52, 0.4], [-2.49, 0.3], [-2.36, 0.292], [-2.3, 0.36], [-2.275, 0.47],
    ], 110);
    addSym(plate(ep, 0.013, 0.5, 0.0045, 6), M.ink, "rearEndplate");
    // endplate rain-light strips
    addSym(strut(V(-2.7, 0.68, 0.5), V(-2.712, 0.86, 0.5), 0.007, 0.016, {}), M.rainLight, "endplateLight");
    // twin swan pylons
    [-0.07, 0.07].forEach((z) => {
      const path = [V(-2.2, 0.39, z), V(-2.3, 0.5, z), V(-2.37, 0.62, z), V(-2.4, 0.735, z)];
      const c = new THREE.CatmullRomCurve3(path);
      const pts = c.getPoints(30);
      add(sweep(pts, (t) => airfoil(28, 0.14, 0, 0.3, 0.02).map(([u, v]) => [(u - 0.4) * (0.1 - 0.02 * t), v * (0.1 - 0.02 * t)] as [number, number]), V(0, 0, 1), { capStart: true, capEnd: true }), M.carbon, car, "pylon");
    });
    // DRS actuator pod
    const pod = roundEnds(stations(-2.44, -2.6, 16).map((x) => superEllipse(20, 0.018, 0.028, 2.4).map(([a, b]) => V(x, 0.81 + b + (x + 2.44) * -0.35, a))), 0.35, 0.35, 0.2);
    add(loft(pod, { capStart: true, capEnd: true }), M.carbon, car, "drsPod");
  }

  /* ================= HALO ================= */
  await tick("Halo & cockpit", 0.66);
  {
    const hoopHalf = [V(-0.245, 0.64, 0.238), V(-0.205, 0.76, 0.236), V(-0.13, 0.842, 0.229), V(0.06, 0.858, 0.232), V(0.26, 0.866, 0.186), V(0.405, 0.871, 0.092)];
    const pts = [...hoopHalf.map((p) => V(p.x, p.y, -p.z)), V(0.455, 0.872, 0), ...[...hoopHalf].reverse()];
    const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
    const path = curve.getPoints(120);
    const sec = superEllipse(28, 0.027, 0.019, 2.3);
    add(sweep(path, () => sec, V(0, 1, 0), { capStart: true, capEnd: true }), M.paint, car, "halo");
    const pillar = new THREE.CatmullRomCurve3([V(0.44, 0.874, 0), V(0.55, 0.82, 0), V(0.64, 0.72, 0), V(0.7, 0.62, 0)]).getPoints(30);
    add(sweep(pillar, (t) => superEllipse(24, 0.034 + 0.01 * t, 0.017, 2.4), V(0, 0, 1), { capStart: true, capEnd: true }), M.paint, car, "haloPillar");
    // rear mount fairings
    [-1, 1].forEach((sgn) => {
      const r = roundEnds(stations(-0.19, -0.31, 12).map((x) => superEllipse(20, 0.03, 0.022, 2.5).map(([a, b]) => V(x, 0.66 + b, sgn * 0.235 + a))), 0.4, 0.3, 0.2);
      add(loft(r, { capStart: true, capEnd: true }), M.paint, car, "haloMount");
    });

    // steering wheel
    const sw = new THREE.Group();
    const swBody = plate(smoothOutline([[0.13, 0.03], [0.12, 0.065], [0.06, 0.075], [-0.06, 0.075], [-0.12, 0.065], [-0.13, 0.03], [-0.13, -0.035], [-0.1, -0.07], [0.1, -0.07], [0.13, -0.035]], 60), 0.035, 0, 0.008, 4);
    add(swBody, M.carbon, sw, "wheelBody");
    const scr = plate(smoothOutline([[0.045, 0.028], [-0.045, 0.028], [-0.045, -0.02], [0.045, -0.02]], 20), 0.006, 0.02, 0.002, 2);
    add(scr, M.screen, sw, "wheelScreen");
    [-1, 1].forEach((sgn) => add(strut(V(sgn * 0.125, -0.06, 0), V(sgn * 0.125, 0.06, 0), 0.05, 0.045, { flow: V(0, 0, 1) }), M.interior, sw, "grip"));
    sw.rotation.y = -Math.PI / 2;
    sw.rotation.z = 0;
    const swWrap = new THREE.Group();
    swWrap.add(sw);
    swWrap.position.set(0.4, 0.565, 0);
    swWrap.rotation.z = -0.35;
    car.add(swWrap);
    add(tube([V(0.42, 0.57, 0), V(0.6, 0.54, 0)], 0.018, 12, 4), M.interior, car, "column");
  }

  /* ================= MIRRORS ================= */
  {
    const housing = roundEnds(stations(0.63, 0.525, 20).map((x) => superEllipse(40, 0.078, 0.03, 3.4).map(([a, b]) => V(x, 0.705 + b, 0.47 + a))), 0.5, 0.06, 0.2);
    addSym(loft(housing, { capStart: true, capEnd: true }), M.ink, "mirrorHousing");
    const glass = plate(smoothOutline([[0.07, 0.022], [-0.07, 0.022], [-0.07, -0.022], [0.07, -0.022]], 40), 0.004, 0, 0.0015, 4);
    glass.rotateY(Math.PI / 2);
    glass.translate(0.523, 0.705, 0.47);
    addSym(glass, M.mirror, "mirrorGlass");
    addSym(strut(V(0.57, 0.68, 0.43), V(0.6, 0.6, 0.235), 0.035, 0.009, { aero: true }), M.ink, "mirrorStay");
    addSym(strut(V(0.56, 0.68, 0.51), V(0.49, 0.61, 0.54), 0.028, 0.008, { aero: true }), M.ink, "mirrorStay2");
  }

  /* ================= WHEELS ================= */
  await tick("Wheels & slick tyres", 0.74);
  const wheelF = buildWheel(FRONT_W, true, M);
  const wheelR = buildWheel(REAR_W, false, M);
  const place = (w: THREE.Group, x: number, z: number, left: boolean) => {
    const c = w.clone();
    c.position.set(x, WHEEL_R, z * (left ? -1 : 1));
    if (left) c.scale.z = -1;
    car.add(c);
  };
  place(wheelF, XF, FRONT_TRACK_Z, false);
  place(wheelF, XF, FRONT_TRACK_Z, true);
  place(wheelR, XR, REAR_TRACK_Z, false);
  place(wheelR, XR, REAR_TRACK_Z, true);

  /* ================= SUSPENSION ================= */
  await tick("Double-wishbone suspension", 0.82);
  {
    const susp = new THREE.Group();
    susp.name = "suspension";
    const S = (g: THREE.BufferGeometry, m: THREE.Material, name: string) => add(g, m, susp, name);
    const joint = (p: THREE.Vector3, r = 0.014) => S(new THREE.SphereGeometry(r, 20, 14).translate(p.x, p.y, p.z), M.titanium, "joint");
    const bracket = (p: THREE.Vector3) => {
      S(strut(p.clone().add(V(0, 0, 0.012)), p.clone().add(V(0, 0, -0.045)), 0.04, 0.03, { flow: V(1, 0, 0) }), M.titanium, "clevis");
      joint(p, 0.012);
    };
    const wishbone = (a: THREE.Vector3, b: THREE.Vector3, o: THREE.Vector3) => {
      S(strut(a, o, 0.05, 0.017, { aero: true }), M.carbon, "wishboneLeg");
      S(strut(b, o, 0.05, 0.017, { aero: true }), M.carbon, "wishboneLeg");
      bracket(a);
      bracket(b);
      joint(o, 0.019);
    };
    const corner = (hp: typeof HARDPOINTS.front, wheelX: number, wheelZ: number, front: boolean) => {
      wishbone(hp.UF, hp.UR, hp.UO);
      wishbone(hp.LF, hp.LR, hp.LO);
      // pushrod
      S(strut(hp.PR_OUT, hp.PR_IN, 0.034, 0.02, { aero: true }), M.carbon, "pushrod");
      joint(hp.PR_OUT, 0.013);
      bracket(hp.PR_IN);
      // track rod / toe link
      S(strut(hp.TR_OUT, hp.TR_IN, 0.03, 0.013, { aero: true }), M.carbon, front ? "trackRod" : "toeLink");
      joint(hp.TR_OUT, 0.012);
      bracket(hp.TR_IN);
      // upright: machined titanium C-body from upper to lower ball joint via hub
      const hubInner = V(wheelX, WHEEL_R, wheelZ - (front ? 0.155 : 0.2));
      const upPath = new THREE.CatmullRomCurve3([
        hp.UO.clone(), hp.UO.clone().lerp(hubInner, 0.55).add(V(0, 0, 0.004)), hubInner.clone(),
        hubInner.clone().lerp(hp.LO, 0.5), hp.LO.clone(),
      ]).getPoints(40);
      S(sweep(upPath, (t) => superEllipse(24, 0.03 - 0.008 * Math.sin(Math.PI * t) * 0, 0.018 + 0.006 * Math.sin(Math.PI * t), 3), V(1, 0, 0), { capStart: true, capEnd: true }), M.titanium, "upright");
      // upright boss + steering/toe arm
      S(tube([hubInner.clone().add(V(0, 0, -0.03)), hubInner.clone().add(V(0, 0, 0.06))], 0.05, 32, 2), M.titanium, "uprightBoss");
      const armBase = hubInner.clone().lerp(hp.UO, 0.45);
      S(strut(armBase, hp.TR_OUT, 0.03, 0.02, { flow: V(0, 1, 0) }), M.titanium, "steeringArm");
      // spindle into hub
      S(tube([hubInner.clone().add(V(0, 0, 0.05)), V(wheelX, WHEEL_R, wheelZ + 0.02)], 0.028, 24, 2), M.steel, "spindle");
      if (!front) {
        // driveshaft with CV boots
        const inner = V(wheelX, 0.3, 0.13), outer = hubInner.clone().add(V(0, 0, -0.02));
        S(strut(inner, outer, 0.042, 0.042, { flow: V(0, 1, 0), seg: 20 }), M.steel, "driveshaft");
        [0.12, 0.88].forEach((t) => {
          const p = inner.clone().lerp(outer, t);
          const d = outer.clone().sub(inner).normalize();
          S(strut(p.clone().addScaledVector(d, -0.04), p.clone().addScaledVector(d, 0.04), 0.075, 0.075, { flow: V(0, 1, 0), seg: 24 }), M.interior, "cvBoot");
        });
      }
    };
    corner(HARDPOINTS.front, XF, FRONT_TRACK_Z, true);
    corner(HARDPOINTS.rear, XR, REAR_TRACK_Z, false);
    // front: rockers/anti-roll housing hint on chassis top is internal; rear pushrod rocker cover on gearbox
    car.add(susp);
    const mir = susp.clone();
    mir.scale.z = -1;
    mir.name = "suspension_L";
    car.add(mir);
  }

  await tick("Finishing", 0.9);
  car.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return car;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Closed thin section around a 2D centreline with rounded ends (for curved plates). */
function thickCurve(c: [number, number][], ht: number): [number, number][] {
  const n = c.length;
  const nrm = c.map((_, i) => {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  });
  const up = c.map((p, i) => [p[0] + nrm[i][0] * ht, p[1] + nrm[i][1] * ht] as [number, number]);
  const dn = c.map((p, i) => [p[0] - nrm[i][0] * ht, p[1] - nrm[i][1] * ht] as [number, number]);
  const cap = (i: number, dir: number) => {
    const out: [number, number][] = [];
    const [px, py] = c[i];
    const [nx, ny] = nrm[i];
    const tx = ny * dir, ty = -nx * dir;
    for (let k = 1; k < 4; k++) {
      const a = (k / 4) * Math.PI;
      const ca = Math.cos(a), sa = Math.sin(a);
      out.push([px + (nx * ca + tx * sa) * ht, py + (ny * ca + ty * sa) * ht]);
    }
    return out;
  };
  return [...up, ...cap(n - 1, -1), ...[...dn].reverse(), ...cap(0, 1)];
}

/** Revolve an (r, a) profile around the Z axis (a = axial position). */
function revolve(profile: [number, number][], seg = 128, opt: { capStart?: boolean; capEnd?: boolean } = {}) {
  const rings = profile.map(([r, a]) => {
    const ring: THREE.Vector3[] = [];
    for (let j = 0; j < seg; j++) {
      const t = (j / seg) * Math.PI * 2;
      ring.push(V(Math.cos(t) * r, Math.sin(t) * r, a));
    }
    return ring;
  });
  return loft(rings, opt);
}

function sampleCurve2(pts: [number, number][], n: number): [number, number][] {
  const c = new THREE.CatmullRomCurve3(pts.map(([x, y]) => V(x, y, 0)), false, "centripetal");
  return c.getPoints(n).map((p) => [p.x, p.y]);
}

/** Wheel assembly for the right-hand side (outboard = +Z), centred at the origin. */
function buildWheel(W: number, front: boolean, M: Materials): THREE.Group {
  const g = new THREE.Group();
  g.name = front ? "wheelFront" : "wheelRear";
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, name: string) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = name;
    g.add(mesh);
    return mesh;
  };
  // open revolved shells (cover, drum, rim) are viewed from both sides
  const shellCarbon = M.carbon.clone();
  shellCarbon.side = THREE.DoubleSide;
  M.rim.side = THREE.DoubleSide;
  M.tyreBand.side = THREE.DoubleSide;
  M.sidewall.side = THREE.DoubleSide;
  M.tread.side = THREE.DoubleSide;
  const hw = W / 2;
  const A = hw * 0.88; // bead seat
  const R = WHEEL_R;
  const rimR = 0.2335;
  const ctrl: [number, number][] = [
    [rimR, -A], [0.25, -hw * 0.965], [0.28, -hw * 1.0], [0.312, -hw * 0.99], [0.338, -hw * 0.94], [0.3545, -hw * 0.82],
    [0.3592, -hw * 0.55], [R, 0], [0.3592, hw * 0.55], [0.3545, hw * 0.82], [0.338, hw * 0.94], [0.312, hw * 0.99],
    [0.28, hw * 1.0], [0.25, hw * 0.965], [rimR, A],
  ];
  const prof = sampleCurve2(ctrl, 110);
  const tIdx = prof.map((p) => p[0] >= 0.3535);
  const first = tIdx.indexOf(true), last = tIdx.lastIndexOf(true);
  add(revolve(prof.slice(0, first + 1), 160), M.sidewall, "sidewallIn");
  add(revolve(prof.slice(first, last + 1), 160), M.tread, "tread");
  add(revolve(prof.slice(last), 160), M.sidewall, "sidewallOut");
  // compound band on the outer sidewall (thin proud ring)
  const band = prof.slice(last).filter(([r]) => r > 0.2955 && r < 0.3005).map(([r, a]) => [r, a + 0.0014] as [number, number]);
  if (band.length >= 2) add(revolve(band, 160), M.tyreBand, "tyreBand");
  // rim: barrel + rolled flanges
  add(revolve([[0.2175, -A - 0.012], [0.216, -A + 0.02], [0.215, A - 0.01], [0.2165, A + 0.004]], 128), M.rim, "rimBarrel");
  const flange = (a0: number, dir: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 16; i++) {
      const t = (i / 16) * Math.PI * 1.25 - Math.PI * 0.25;
      pts.push([0.232 + Math.sin(t) * 0.0075, a0 + dir * (0.0075 - Math.cos(t) * 0.0075)]);
    }
    return pts;
  };
  add(revolve(flange(A, 1), 128), M.rim, "rimFlangeOut");
  add(revolve(flange(-A, -1), 128), M.rim, "rimFlangeIn");
  // aero wheel cover (outboard), dished carbon with machined ring
  const cov: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const r = lerp(0.2305, 0.058, t);
    cov.push([r, A + 0.004 - 0.028 * Math.sin((t * Math.PI) / 2) ** 1.4]);
  }
  add(revolve(cov, 128), shellCarbon, "wheelCover");
  add(revolve([[0.205, A - 0.004 + 0.002], [0.198, A - 0.006]].map(([r, a]) => [r, a - 0.0] as [number, number]), 128), M.rim, "coverRing");
  // centre lock hub + wheel nut
  const nut: [number, number][] = [[0.058, A - 0.024], [0.05, A - 0.02], [0.046, A + 0.005], [0.04, A + 0.02], [0.03, A + 0.028], [0.012, A + 0.03], [0.001, A + 0.03]];
  add(revolve(nut, 48), M.aluminium, "wheelNut");
  add(revolve([[0.049, A - 0.012], [0.0495, A - 0.004], [0.048, A - 0.002]], 48), M.vermilion, "nutClip");
  // brake duct drum (inboard) with inlet
  const dr = 0.15;
  const drumA0 = -A - 0.004, drumA1 = -A - 0.075;
  add(revolve([[dr - 0.004, drumA0], [dr, drumA0 - 0.006], [dr, drumA1 + 0.01], [dr - 0.012, drumA1], [0.06, drumA1 - 0.004], [0.035, drumA1 - 0.004]], 96), shellCarbon, "brakeDrum");
  // disc glimpse ring
  add(revolve([[0.212, -A + 0.03], [0.212, -A - 0.004]], 96), M.interior, "rimShadowRing");
  // inlet scoop facing forward
  const scoopRings = stations(0.0, 0.14, 14).map((t) => {
    const cx = 0.1 + t * 0.55; // forward
    return superEllipse(24, 0.032 * (1 + t), 0.02, 3).map(([a, b]) => V(cx, -0.06 + b - t * 0.1, (drumA0 + drumA1) / 2 + a));
  });
  add(loft(scoopRings, { capStart: true }), shellCarbon, front ? "ductInlet" : "ductInletRear");
  if (!front) {
    // rear duct winglet
    const wl = strut(V(0.02, 0.2, drumA1 + 0.02), V(-0.16, 0.14, drumA1 + 0.02), 0.004, 0.05, {});
    add(wl, M.carbon, "ductWinglet");
  }
  return g;
}
