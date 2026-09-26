import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { HorizontalBlurShader } from "three/examples/jsm/shaders/HorizontalBlurShader.js";
import { VerticalBlurShader } from "three/examples/jsm/shaders/VerticalBlurShader.js";

export const BG = new THREE.Color().setRGB(0.165, 0.168, 0.176, THREE.SRGBColorSpace);

/* ------------------------------------------------------------------ */
/*  Procedural HDR studio: soft-edged emissive softboxes (radiance > 1) */
/*  rendered to a cube map and prefiltered with PMREM.                  */
/* ------------------------------------------------------------------ */
function softbox(w: number, h: number, intensity: number, color = new THREE.Color(1, 1, 1), feather = 0.18) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone().multiplyScalar(intensity) }, uFeather: { value: feather } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform vec3 uColor; uniform float uFeather; varying vec2 vUv;
      void main(){ vec2 d = min(vUv, 1.0 - vUv); float e = smoothstep(0.0, uFeather, d.x) * smoothstep(0.0, uFeather, d.y);
      // slight centre hot-spot like a real diffusion panel
      float hs = 0.85 + 0.15 * (1.0 - length(vUv - 0.5) * 1.4);
      gl_FragColor = vec4(uColor * e * hs, 1.0); }`,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

export function buildStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  // dark room with a gentle vertical gradient (floor darker than ceiling)
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(30, 64, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: `varying vec3 vP; void main(){ float h = normalize(vP).y;
        vec3 c = mix(vec3(0.03), vec3(0.075), smoothstep(-0.2, 0.6, h));
        // faint horizon band gives bodywork a readable reflected horizon
        c += vec3(0.25) * exp(-pow((h - 0.05) / 0.05, 2.0));
        gl_FragColor = vec4(c, 1.0); }`,
    })
  );
  env.add(room);

  // large overhead softbox (key reflection along the body's upper surfaces)
  const top = softbox(7.5, 2.6, 5.0, new THREE.Color(1, 0.985, 0.96), 0.22);
  top.position.set(0, 7.5, 0);
  top.rotation.x = Math.PI / 2;
  env.add(top);
  // front-right tall strip (hero side flank highlight)
  const s1 = softbox(1.3, 6, 3.2, new THREE.Color(1, 0.99, 0.97));
  s1.position.set(7, 2.8, 7);
  s1.lookAt(0, 0.8, 0);
  env.add(s1);
  // front-left strip
  const s2 = softbox(1.3, 6, 2.2, new THREE.Color(0.96, 0.98, 1));
  s2.position.set(7, 2.8, -7);
  s2.lookAt(0, 0.8, 0);
  env.add(s2);
  // rear rim strips
  const s3 = softbox(1.1, 6, 2.8, new THREE.Color(0.95, 0.97, 1));
  s3.position.set(-9, 3, 4);
  s3.lookAt(0, 0.8, 0);
  env.add(s3);
  const s4 = softbox(1.1, 6, 2.0);
  s4.position.set(-9, 3, -5);
  s4.lookAt(0, 0.8, 0);
  env.add(s4);
  // low side kicker panels (so sidepod undercuts and flanks don't go black)
  const k1 = softbox(9, 1.6, 1.8);
  k1.position.set(0, 1.2, 10);
  k1.lookAt(0, 0.5, 0);
  env.add(k1);
  const k2 = softbox(9, 1.6, 1.4);
  k2.position.set(0, 1.2, -10);
  k2.lookAt(0, 0.5, 0);
  env.add(k2);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.015, 0.1, 60, { size: 512, position: new THREE.Vector3(0, 0.6, 0) } as never);
  pmrem.dispose();
  env.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  return rt.texture;
}

/* ------------------------------------------------------------------ */
/*  Floor: matte studio floor fading radially into the background       */
/* ------------------------------------------------------------------ */
export function buildFloor(): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(0.27, 0.272, 0.28, THREE.SRGBColorSpace),
    roughness: 0.62,
    metalness: 0,
    envMapIntensity: 0.55,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBg = { value: new THREE.Vector3(BG.r, BG.g, BG.b) };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFloorW;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvFloorW = (modelMatrix * vec4(transformed,1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFloorW;\nuniform vec3 uBg;")
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        float fr = length(vFloorW.xz * vec2(0.62, 1.0));
        float fk = smoothstep(2.6, 11.0, fr);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uBg, fk);`
      );
  };
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 96).rotateX(-Math.PI / 2), mat);
  floor.receiveShadow = true;
  floor.name = "floor";
  return floor;
}

/* ------------------------------------------------------------------ */
/*  Baked contact shadows (depth-from-below, blurred) — the car is      */
/*  static, so this is rendered once at high quality.                   */
/* ------------------------------------------------------------------ */
export function bakeContactShadow(
  renderer: THREE.WebGLRenderer,
  target: THREE.Object3D,
  opts: { width: number; depth: number; height: number; blur: number; darkness: number; opacity: number; res: number; y?: number }
): THREE.Mesh {
  const resX = opts.res;
  const resY = Math.round((opts.res * opts.depth) / opts.width);
  const rt = new THREE.WebGLRenderTarget(resX, resY, { type: THREE.HalfFloatType });
  rt.texture.generateMipmaps = false;
  const rtBlur = new THREE.WebGLRenderTarget(resX, resY, { type: THREE.HalfFloatType });
  const cam = new THREE.OrthographicCamera(-opts.width / 2, opts.width / 2, opts.depth / 2, -opts.depth / 2, 0, opts.height);
  cam.rotation.x = Math.PI / 2;
  cam.position.y = 0.0;

  const depthMat = new THREE.MeshDepthMaterial();
  depthMat.side = THREE.DoubleSide;
  depthMat.onBeforeCompile = (sh) => {
    sh.uniforms.darkness = { value: opts.darkness };
    sh.fragmentShader =
      "uniform float darkness;\n" +
      sh.fragmentShader.replace(
        "gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );",
        "gl_FragColor = vec4( vec3( 0.0 ), pow(1.0 - fragCoordZ, 1.6) * darkness );"
      );
  };
  depthMat.depthTest = false;
  depthMat.depthWrite = false;

  const tmp = new THREE.Scene();
  tmp.overrideMaterial = depthMat;
  const parent = target.parent;
  tmp.add(target);
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(tmp, cam);
  if (parent) parent.add(target);

  const hb = new THREE.ShaderMaterial(HorizontalBlurShader);
  const vb = new THREE.ShaderMaterial(VerticalBlurShader);
  hb.depthTest = vb.depthTest = false;
  const q = new FullScreenQuad(hb);
  const passes = 4;
  for (let i = 0; i < passes; i++) {
    const s = opts.blur * (1 - i / (passes + 1));
    q.material = hb;
    hb.uniforms.tDiffuse.value = rt.texture;
    hb.uniforms.h.value = s / resX;
    renderer.setRenderTarget(rtBlur);
    q.render(renderer);
    q.material = vb;
    vb.uniforms.tDiffuse.value = rtBlur.texture;
    vb.uniforms.v.value = s / resY;
    renderer.setRenderTarget(rt);
    q.render(renderer);
  }
  renderer.setRenderTarget(null);
  renderer.setClearColor(prevClear, prevAlpha);
  q.dispose();
  hb.dispose();
  vb.dispose();
  rtBlur.dispose();
  depthMat.dispose();

  const planeMat = new THREE.MeshBasicMaterial({ map: rt.texture, transparent: true, opacity: opts.opacity, depthWrite: false, color: 0x000000 });
  // use the texture alpha as shadow; colour black
  planeMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", "vec4 sm = texture2D( map, vMapUv ); diffuseColor = vec4(0.0, 0.0, 0.0, sm.a * opacity);");
  };
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(opts.width, opts.depth).rotateX(Math.PI / 2), planeMat);
  plane.scale.y = -1;
  plane.position.y = opts.y ?? 0.001;
  plane.renderOrder = 1;
  plane.name = "contactShadow";
  return plane;
}

/** Backdrop dome with finite depth (so screen-space AO treats it as distant surface, not void). */
export function buildBackdrop(): THREE.Mesh {
  const top = new THREE.Color().setRGB(0.07, 0.072, 0.078, THREE.SRGBColorSpace);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uHorizon: { value: BG.clone() }, uTop: { value: top } },
    vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `uniform vec3 uHorizon; uniform vec3 uTop; varying vec3 vP;
      void main(){ float h = normalize(vP).y; vec3 c = mix(uHorizon, uTop, smoothstep(0.0, 0.45, h));
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(55, 48, 24), m);
  mesh.name = "backdrop";
  mesh.renderOrder = -1;
  return mesh;
}
