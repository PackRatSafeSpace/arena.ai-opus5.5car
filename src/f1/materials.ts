import * as THREE from "three";

/* ------------------------------------------------------------------ */
/*  Procedural 2x2 twill carbon fibre                                   */
/* ------------------------------------------------------------------ */
function canvas(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  return { c, ctx, img: ctx.createImageData(size, size) };
}

function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

interface CarbonMaps {
  map: THREE.CanvasTexture;
  normal: THREE.CanvasTexture;
  rough: THREE.CanvasTexture;
  aniso: THREE.CanvasTexture;
}

function buildCarbonMaps(maxAniso: number): CarbonMaps {
  const S = 512;
  const TOWS = 8; // tows per tile edge (two full twill repeats)
  const cell = S / TOWS;
  const A = canvas(S), N = canvas(S), R = canvas(S), T = canvas(S);
  const height = new Float32Array(S * S);
  const horiz = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = Math.floor(x / cell), j = Math.floor(y / cell);
      const fx = (x % cell) / cell, fy = (y % cell) / cell;
      const h = ((i + j) & 3) < 2; // 2x2 twill
      const across = h ? fy : fx;
      const along = h ? fx : fy;
      // tow cross-profile bulge + dive at ends where it passes under the crossing tow
      const bulge = Math.sin(Math.PI * across) ** 0.6;
      const dive = 0.75 + 0.25 * Math.sin(Math.PI * along);
      const fib = 0.5 + 0.5 * Math.sin((h ? y : x) * 2.3 + hash(i, j) * 6.28);
      height[y * S + x] = bulge * dive * (0.94 + 0.06 * fib);
      horiz[y * S + x] = h ? 1 : 0;
    }
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const k = y * S + x, o = k * 4;
      const hL = height[y * S + ((x - 1 + S) % S)], hR = height[y * S + ((x + 1) % S)];
      const hD = height[((y - 1 + S) % S) * S + x], hU = height[((y + 1) % S) * S + x];
      const nx = (hL - hR) * 2.2, ny = (hD - hU) * 2.2;
      const len = Math.hypot(nx, ny, 1);
      N.img.data[o] = (nx / len * 0.5 + 0.5) * 255;
      N.img.data[o + 1] = (ny / len * 0.5 + 0.5) * 255;
      N.img.data[o + 2] = (1 / len * 0.5 + 0.5) * 255;
      N.img.data[o + 3] = 255;
      const hgt = height[k];
      const i = Math.floor(x / cell), j = Math.floor(y / cell);
      const tone = 21 + hgt * 7 + hash(i * 3.1, j * 7.7) * 2.5 + (hash(x, y) - 0.5) * 2;
      A.img.data[o] = tone; A.img.data[o + 1] = tone; A.img.data[o + 2] = tone * 1.04; A.img.data[o + 3] = 255;
      const r = 150 - hgt * 45 + hash(y, x) * 10;
      R.img.data[o] = r; R.img.data[o + 1] = r; R.img.data[o + 2] = r; R.img.data[o + 3] = 255;
      // anisotropy direction per tow (tangent space): horizontal -> (1,0) vertical -> (0,1)
      const hz = horiz[k];
      T.img.data[o] = hz ? 255 : 128;
      T.img.data[o + 1] = hz ? 128 : 255;
      T.img.data[o + 2] = 255 * (0.35 + 0.65 * hgt);
      T.img.data[o + 3] = 255;
    }
  }
  const mk = (cv: ReturnType<typeof canvas>, srgb: boolean) => {
    cv.ctx.putImageData(cv.img, 0, 0);
    const t = new THREE.CanvasTexture(cv.c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { map: mk(A, true), normal: mk(N, false), rough: mk(R, false), aniso: mk(T, false) };
}

/* ------------------------------------------------------------------ */
/*  Livery paint (per-pixel graphic, clearcoat)                         */
/* ------------------------------------------------------------------ */
const LIVERY_GLSL = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNorm;
varying float vInterior;
vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
float aaStep(float edge, float x){ float w = max(fwidth(x), 1e-5) * 0.75; return smoothstep(edge - w, edge + w, x); }
// swept separation line between ivory upper body and ink lower flanks
float liveryLine(float x){
  return mix(0.205, 0.515, smoothstep(3.0, 1.15, x)) - 0.11 * smoothstep(0.35, -1.45, x) + 0.02 * smoothstep(-1.4, -2.2, x);
}
vec3 livery(vec3 p, vec3 n, out float interior){
  vec3 ivory = lin(vec3(0.905, 0.890, 0.855));
  vec3 ink   = lin(vec3(0.095, 0.15, 0.245));
  vec3 red   = lin(vec3(0.86, 0.17, 0.10));
  float slope = max(0.18, sqrt(max(0.0, 1.0 - n.y * n.y)));
  float d = p.y - liveryLine(p.x);
  float upper = aaStep(0.0, d);
  vec3 c = mix(ink, ivory, upper);
  // vermilion pinstripe sitting on the ivory side of the break, constant width on the surface
  float sw = 0.0075 * slope;
  float stripe = aaStep(0.0035 * slope, d) * (1.0 - aaStep(0.0035 * slope + sw, d));
  c = mix(c, red, stripe);
  // vermilion nose tip
  c = mix(c, red, aaStep(2.955, p.x));
  interior = max(step(0.5, vInterior), gl_FrontFacing ? 0.0 : 1.0);
  c = mix(c, vec3(0.010), interior);
  return c;
}
`;

function patchPaint(m: THREE.MeshPhysicalMaterial) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float interior;\nvarying float vInterior;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;"
      )
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvInterior = interior;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNorm = normalize(mat3(modelMatrix) * objectNormal);"
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\n" + LIVERY_GLSL)
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        "float livInterior = 0.0;\nvec3 livColor = livery(vWPos, normalize(vWNorm), livInterior);\nvec4 diffuseColor = vec4( livColor, opacity );"
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, livInterior);"
      )
      .replace(
        "#include <lights_physical_fragment>",
        "#include <lights_physical_fragment>\nmaterial.clearcoat *= (1.0 - livInterior);"
      );
  };
  m.customProgramCacheKey = () => "f1-livery-v3";
}

export interface Materials {
  paint: THREE.MeshPhysicalMaterial;
  ink: THREE.MeshPhysicalMaterial;
  vermilion: THREE.MeshPhysicalMaterial;
  ivory: THREE.MeshPhysicalMaterial;
  carbon: THREE.MeshPhysicalMaterial;
  carbonMatte: THREE.MeshPhysicalMaterial;
  interior: THREE.MeshStandardMaterial;
  tread: THREE.MeshPhysicalMaterial;
  sidewall: THREE.MeshPhysicalMaterial;
  tyreBand: THREE.MeshPhysicalMaterial;
  rim: THREE.MeshPhysicalMaterial;
  titanium: THREE.MeshPhysicalMaterial;
  aluminium: THREE.MeshPhysicalMaterial;
  steel: THREE.MeshPhysicalMaterial;
  mirror: THREE.MeshPhysicalMaterial;
  rainLight: THREE.MeshStandardMaterial;
  blackGloss: THREE.MeshPhysicalMaterial;
  exhaust: THREE.MeshPhysicalMaterial;
  screen: THREE.MeshStandardMaterial;
}

export function createMaterials(maxAniso: number): Materials {
  const cm = buildCarbonMaps(maxAniso);
  const TILE = 0.052; // metres per texture tile (8 tows -> ~8.7 mm tows)
  const rep = 1 / TILE;
  const carbonTex = (t: THREE.Texture) => {
    const c = t.clone();
    c.repeat.set(rep, rep);
    c.needsUpdate = true;
    return c;
  };

  const paint = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.32,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.045,
    specularIntensity: 0.6,
  });
  patchPaint(paint);

  const ink = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.095, 0.15, 0.245, THREE.SRGBColorSpace),
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  const vermilion = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.86, 0.17, 0.1, THREE.SRGBColorSpace),
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });

  const ivory = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.905, 0.89, 0.855, THREE.SRGBColorSpace),
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.045,
    specularIntensity: 0.6,
  });

  const carbon = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: carbonTex(cm.map),
    normalMap: carbonTex(cm.normal),
    normalScale: new THREE.Vector2(0.22, 0.22),
    roughnessMap: carbonTex(cm.rough),
    roughness: 0.62,
    metalness: 0.0,
    anisotropy: 0.55,
    anisotropyMap: carbonTex(cm.aniso),
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
    specularIntensity: 0.8,
  });
  const carbonMatte = new THREE.MeshPhysicalMaterial({
    color: 0xcfcfcf,
    map: carbonTex(cm.map),
    normalMap: carbonTex(cm.normal),
    normalScale: new THREE.Vector2(0.25, 0.25),
    roughness: 0.78,
    anisotropy: 0.35,
    anisotropyMap: carbonTex(cm.aniso),
  });
  const interior = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.75 });

  const tread = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.14, 0.14, 0.145, THREE.SRGBColorSpace),
    roughness: 0.7,
    specularIntensity: 0.45,
  });
  const sidewall = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.1, 0.1, 0.105, THREE.SRGBColorSpace),
    roughness: 0.48,
    specularIntensity: 0.5,
    sheen: 0.25,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(0x303036),
  });
  const tyreBand = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.62, 0.62, 0.6, THREE.SRGBColorSpace),
    roughness: 0.6,
  });
  const rim = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.16, 0.165, 0.175, THREE.SRGBColorSpace),
    metalness: 1,
    roughness: 0.34,
    clearcoat: 0.4,
    clearcoatRoughness: 0.2,
  });
  const titanium = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.62, 0.6, 0.575, THREE.SRGBColorSpace),
    metalness: 1,
    roughness: 0.3,
  });
  const aluminium = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.86, 0.87, 0.88, THREE.SRGBColorSpace),
    metalness: 1,
    roughness: 0.2,
  });
  const steel = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.55, 0.56, 0.58, THREE.SRGBColorSpace),
    metalness: 1,
    roughness: 0.16,
  });
  const mirror = new THREE.MeshPhysicalMaterial({ color: 0xe8ecf0, metalness: 1, roughness: 0.03 });
  const rainLight = new THREE.MeshStandardMaterial({
    color: 0x1a0202,
    emissive: new THREE.Color(1, 0.03, 0.02),
    emissiveIntensity: 2.4,
    roughness: 0.3,
  });
  const blackGloss = new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 });
  const exhaust = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color().setRGB(0.46, 0.4, 0.36, THREE.SRGBColorSpace),
    metalness: 1,
    roughness: 0.42,
  });
  const screen = new THREE.MeshStandardMaterial({ color: 0x020203, roughness: 0.15, emissive: 0x0a1a24, emissiveIntensity: 0.6 });

  return {
    paint, ink, vermilion, ivory, carbon, carbonMatte, interior, tread, sidewall, tyreBand, rim,
    titanium, aluminium, steel, mirror, rainLight, blackGloss, exhaust, screen,
  };
}
