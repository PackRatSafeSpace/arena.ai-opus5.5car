import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Pass, FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { createMaterials } from "./materials";
import { buildCar } from "./car";
import { BG, buildStudioEnvironment, buildFloor, bakeContactShadow, buildBackdrop } from "./studio";

/* ------------------------------------------------------------------ */
/*  Progressive accumulation: running average of jittered frames.       */
/* ------------------------------------------------------------------ */
class AccumulatePass extends Pass {
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;
  private blend: THREE.ShaderMaterial;
  private copy: THREE.ShaderMaterial;
  private quad: FullScreenQuad;
  count = 0;
  constructor(w: number, h: number) {
    super();
    const o = { type: THREE.HalfFloatType, depthBuffer: false };
    this.a = new THREE.WebGLRenderTarget(w, h, o);
    this.b = new THREE.WebGLRenderTarget(w, h, o);
    const vs = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
    this.blend = new THREE.ShaderMaterial({
      uniforms: { tNew: { value: null }, tOld: { value: null }, w: { value: 1 } },
      vertexShader: vs,
      fragmentShader: "uniform sampler2D tNew; uniform sampler2D tOld; uniform float w; varying vec2 vUv; void main(){ gl_FragColor = mix(texture2D(tOld, vUv), texture2D(tNew, vUv), w); }",
      depthTest: false,
      depthWrite: false,
    });
    this.copy = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: vs,
      fragmentShader: "uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }",
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.blend);
  }
  reset() {
    this.count = 0;
  }
  setSize(w: number, h: number) {
    this.a.setSize(w, h);
    this.b.setSize(w, h);
    this.count = 0;
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.blend.uniforms.tNew.value = readBuffer.texture;
    this.blend.uniforms.tOld.value = this.a.texture;
    this.blend.uniforms.w.value = 1 / (this.count + 1);
    this.quad.material = this.blend;
    renderer.setRenderTarget(this.b);
    this.quad.render(renderer);
    const t = this.a;
    this.a = this.b;
    this.b = t;
    this.count++;
    this.copy.uniforms.tDiffuse.value = this.a.texture;
    this.quad.material = this.copy;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() {
    this.a.dispose();
    this.b.dispose();
    this.blend.dispose();
    this.copy.dispose();
    this.quad.dispose();
  }
}

function halton(i: number, b: number) {
  let f = 1, r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
}

export type ViewName = "hero" | "front" | "rear" | "side" | "rear34" | "front34L" | "top" | "suspFront" | "suspRear" | "suspFrontTop";

interface ViewDef { pos: [number, number, number]; target: [number, number, number]; fitDir?: boolean }
const HERO_TARGET = new THREE.Vector3(0.12, 0.34, 0);
const VIEWS: Record<ViewName, ViewDef> = {
  hero: { pos: [0.8, 0.22, 0.56], target: [0.3, 0.3, 0], fitDir: true },
  front: { pos: [1, 0.17, 0], target: [0.2, 0.38, 0], fitDir: true },
  rear: { pos: [-1, 0.2, 0], target: [0.0, 0.42, 0], fitDir: true },
  side: { pos: [0, 0.1, 1], target: [0.12, 0.42, 0], fitDir: true },
  rear34: { pos: [-0.75, 0.32, -0.6], target: [0.0, 0.38, 0], fitDir: true },
  front34L: { pos: [0.72, 0.36, -0.66], target: [0.12, 0.34, 0], fitDir: true },
  top: { pos: [0.001, 1, 0.0], target: [0.1, 0.3, 0], fitDir: true },
  suspFront: { pos: [3.2, 1.22, 0.3], target: [1.78, 0.36, 0.48] },
  suspFrontTop: { pos: [1.2, 1.3, 1.45], target: [1.8, 0.36, 0.45] },
  suspRear: { pos: [-2.75, 1.85, 1.35], target: [-1.85, 0.3, 0.42] },
};

export interface ViewerCallbacks {
  onProgress: (label: string, frac: number) => void;
  onSamples?: (n: number, max: number) => void;
}

export class Viewer {
  private container: HTMLElement;
  private cb: ViewerCallbacks;
  renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 0.05, 120);
  private controls!: OrbitControls;
  private composer!: EffectComposer;
  private gtao!: GTAOPass;
  private accum!: AccumulatePass;
  private key!: THREE.DirectionalLight;
  private keyBase = new THREE.Vector3(1.2, 8.5, 2.6);
  private raf = 0;
  private sample = 0;
  maxSamples = 96;
  private lastMatrix = new THREE.Matrix4();
  private lastProj = new THREE.Matrix4();
  private anim: { t0: number; dur: number; p0: THREE.Vector3; p1: THREE.Vector3; q0: THREE.Vector3; q1: THREE.Vector3 } | null = null;
  private ro?: ResizeObserver;
  private disposed = false;
  private size = new THREE.Vector2(1, 1);

  constructor(container: HTMLElement, cb: ViewerCallbacks) {
    this.container = container;
    this.cb = cb;
  }

  private async tick(label: string, frac: number) {
    this.cb.onProgress(label, frac);
    await new Promise((r) => setTimeout(r, 16));
  }

  async init() {
    await this.tick("Initialising WebGL 2", 0.02);
    const probe = document.createElement("canvas");
    if (!probe.getContext("webgl2")) throw new Error("WebGL 2 is not available in this browser or has been disabled. Try a current Chrome, Edge, Firefox or Safari with hardware acceleration enabled.");
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", alpha: false, preserveDrawingBuffer: true });
    } catch {
      throw new Error("Could not create a WebGL 2 context. Hardware acceleration may be disabled.");
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.08;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.domElement.style.display = "block";
    r.domElement.style.width = "100%";
    r.domElement.style.height = "100%";
    r.domElement.style.touchAction = "none";
    this.container.appendChild(r.domElement);
    r.domElement.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.cb.onProgress("__contextlost__", 0);
    });

    this.scene.background = BG.clone();
    await this.tick("Studio lighting environment", 0.05);
    this.scene.environment = buildStudioEnvironment(r);
    this.scene.environmentIntensity = 1.35;

    const M = createMaterials(r.capabilities.getMaxAnisotropy());
    M.paint.side = THREE.DoubleSide;
    const car = await buildCar(M, (l, f) => this.tick(l, 0.06 + f * 0.7));
    this.scene.add(car);

    await this.tick("Key light & shadows", 0.8);
    const key = new THREE.DirectionalLight(0xfff6ec, 1.9);
    key.position.copy(this.keyBase);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096);
    const sc = key.shadow.camera;
    sc.left = -3.4; sc.right = 3.4; sc.top = 3.4; sc.bottom = -3.4; sc.near = 4; sc.far = 13;
    key.shadow.bias = -0.00015;
    key.shadow.normalBias = 0.012;
    key.shadow.radius = 3;
    this.key = key;
    this.scene.add(key, key.target);

    this.scene.add(buildFloor());
    this.scene.add(buildBackdrop());

    await this.tick("Baking contact shadows", 0.84);
    this.scene.add(bakeContactShadow(r, car, { width: 7.2, depth: 3.0, height: 0.22, blur: 1.4, darkness: 1.35, opacity: 0.95, res: 1536, y: 0.0012 }));
    this.scene.add(bakeContactShadow(r, car, { width: 8.0, depth: 3.8, height: 0.9, blur: 5.5, darkness: 0.9, opacity: 0.55, res: 768, y: 0.0008 }));

    await this.tick("Post-processing", 0.88);
    this.camera.position.set(6, 2, 4);
    this.controls = new OrbitControls(this.camera, r.domElement);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.075;
    c.rotateSpeed = 0.7;
    c.zoomSpeed = 0.9;
    c.minDistance = 1.6;
    c.maxDistance = 16;
    c.maxPolarAngle = Math.PI * 0.492;
    c.screenSpacePanning = true;
    c.zoomToCursor = true;
    c.addEventListener("start", () => (this.anim = null));
    c.addEventListener("change", () => this.clampTarget());

    this.buildComposer();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.container);
    this.resize();
    this.setView("hero", false);

    await this.tick("Compiling shaders", 0.93);
    try {
      await r.compileAsync(this.scene, this.camera);
    } catch {
      /* fall back to lazy compile */
    }
    await this.tick("Ready", 1);
    this.loop();
    (window as unknown as { __f1: unknown }).__f1 = {
      setView: (n: ViewName) => this.setView(n, false),
      samples: () => this.sample,
      max: () => this.maxSamples,
      setMax: (n: number) => { this.maxSamples = n; this.sample = 0; },
      camera: this.camera,
      scene: this.scene,
      controls: this.controls,
    };
  }

  private buildComposer() {
    const r = this.renderer;
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    const pr = r.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = new GTAOPass(this.scene, this.camera, w * pr, h * pr);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.7;
    this.gtao.updateGtaoMaterial({ radius: 0.22, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: 16, distanceFallOff: 1.0 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 16 });
    this.composer.addPass(this.gtao);
    this.accum = new AccumulatePass(w * pr, h * pr);
    this.composer.addPass(this.accum);
    this.composer.addPass(new OutputPass());
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    if (w === this.size.x && h === this.size.y) return;
    const prevAspect = this.size.x / this.size.y;
    this.size.set(w, h);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.gtao.setSize(w * pr, h * pr);
    this.accum.setSize(w * pr, h * pr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // keep the car framed when the aspect changes substantially (only at rest)
    if (!this.anim && isFinite(prevAspect) && Math.abs(prevAspect - w / h) > 0.25 && this.sample > 0) {
      this.controls.update();
    }
    this.sample = 0;
  }

  private clampTarget() {
    const t = this.controls.target;
    t.x = THREE.MathUtils.clamp(t.x, -3.2, 3.4);
    t.y = THREE.MathUtils.clamp(t.y, 0.05, 1.1);
    t.z = THREE.MathUtils.clamp(t.z, -1.3, 1.3);
  }

  /** Distance so the car (≈5.7 x 2.0 x 0.95 m) fills the frame from a given direction. */
  private fitDistance(dir: THREE.Vector3, target = HERO_TARGET, fill = 0.86) {
    // perspective-correct fit: binary search the distance at which every bounding-box corner projects
    // inside `fill` of the viewport
    const box = new THREE.Box3(new THREE.Vector3(-2.72, 0, -1.0), new THREE.Vector3(2.99, 0.96, 1.0));
    const cam = this.camera.clone();
    const d = dir.clone().normalize();
    const corners: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    const fits = (dist: number) => {
      cam.position.copy(target).addScaledVector(d, dist);
      if (Math.abs(d.y) > 0.99) cam.up.set(-1, 0, 0);
      else cam.up.set(0, 1, 0);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      return corners.every((c) => {
        const p = c.clone().project(cam);
        return p.z < 1 && Math.abs(p.x) <= fill && Math.abs(p.y) <= fill;
      });
    };
    let lo = 1, hi = 40;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  setView(name: ViewName, animate = true) {
    const v = VIEWS[name];
    const target = new THREE.Vector3(...v.target);
    let pos: THREE.Vector3;
    if (v.fitDir) {
      const dir = new THREE.Vector3(...v.pos).normalize();
      pos = target.clone().addScaledVector(dir, this.fitDistance(dir, target, name === "hero" ? 0.84 : 0.88));
    } else pos = new THREE.Vector3(...v.pos);
    if (!animate) {
      this.anim = null;
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.sample = 0;
      return;
    }
    this.anim = { t0: performance.now(), dur: 1100, p0: this.camera.position.clone(), p1: pos, q0: this.controls.target.clone(), q1: target };
  }

  reset() {
    this.setView("hero", true);
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.anim) {
      const a = this.anim;
      const t = Math.min(1, (performance.now() - a.t0) / a.dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      // interpolate in spherical coordinates around the moving target for a graceful arc
      const q = a.q0.clone().lerp(a.q1, e);
      const s0 = new THREE.Spherical().setFromVector3(a.p0.clone().sub(a.q0));
      const s1 = new THREE.Spherical().setFromVector3(a.p1.clone().sub(a.q1));
      let dTheta = s1.theta - s0.theta;
      if (dTheta > Math.PI) dTheta -= Math.PI * 2;
      if (dTheta < -Math.PI) dTheta += Math.PI * 2;
      const s = new THREE.Spherical(
        THREE.MathUtils.lerp(s0.radius, s1.radius, e),
        THREE.MathUtils.lerp(s0.phi, s1.phi, e),
        s0.theta + dTheta * e
      );
      this.controls.target.copy(q);
      this.camera.position.copy(q).add(new THREE.Vector3().setFromSpherical(s));
      if (t >= 1) this.anim = null;
    }
    this.controls.update();
    this.camera.updateMatrixWorld();
    const moved = !this.camera.matrixWorld.equals(this.lastMatrix) || !this.camera.projectionMatrix.equals(this.lastProj);
    if (moved) {
      this.sample = 0;
      this.lastMatrix.copy(this.camera.matrixWorld);
    }
    if (this.sample >= this.maxSamples) return;
    this.render();
  };

  private render() {
    const w = this.size.x * this.renderer.getPixelRatio();
    const h = this.size.y * this.renderer.getPixelRatio();
    if (this.sample === 0) {
      this.accum.reset();
      this.camera.clearViewOffset();
      this.key.position.copy(this.keyBase);
    } else {
      const i = this.sample;
      const jx = halton(i + 1, 2) - 0.5, jy = halton(i + 1, 3) - 0.5;
      this.camera.setViewOffset(w, h, jx, jy, w, h);
      // soft area key light: jitter over a 1.4 m disc
      const a = halton(i + 1, 5) * Math.PI * 2, rr = Math.sqrt(halton(i + 1, 7)) * 0.7;
      this.key.position.set(this.keyBase.x + Math.cos(a) * rr, this.keyBase.y, this.keyBase.z + Math.sin(a) * rr);
    }
    this.composer.render();
    this.lastProj.copy(this.camera.projectionMatrix);
    if (this.sample > 0) {
      this.camera.clearViewOffset();
      this.lastProj.copy(this.camera.projectionMatrix);
    }
    this.sample++;
    this.cb.onSamples?.(this.sample, this.maxSamples);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.controls?.dispose();
    this.accum?.dispose();
    this.composer?.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
  }
}

export { HERO_TARGET };
