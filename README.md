# ARC·26 — Formula 1 studio piece (Three.js)

An original 2022–2025 ground-effect-era Formula 1 car, modelled entirely from custom procedural
geometry and rendered in the browser as an interactive product shot.

## Run

```bash
npm install
npm run dev        # http://localhost:5173 (development)
npm run build      # produces a single self-contained dist/index.html
npm run preview    # serve the production build
```

`dist/index.html` is fully self-contained (all code, geometry generation and textures are inlined).
It runs straight from disk or any static host. It needs WebGL 2.

Controls: drag to orbit, scroll/pinch to zoom toward the cursor, right-drag/two fingers to pan,
**R** or the ↺ button resets the hero camera, **?** shows the controls. When the camera stops moving,
the render keeps refining progressively (sub-pixel jitter plus soft area-light shadow jitter, up to
96 frames) into a supersampled still.

## Where the model lives (editable source)

There is no Blender file. The car is generated at load time from parametric TypeScript source,
and that source is the editable model:

| File | Contents |
| --- | --- |
| `src/f1/geom.ts` | Modelling kernel: monotone-cubic key interpolation, loft with analytic seam-free normals, rounded ends, Catmull-Rom sections, NACA-style cambered airfoils, faired struts, sweeps, revolves, rounded plates |
| `src/f1/car.ts` | The car. Chassis/nose with a real cockpit channel, engine cover and airbox, undercut downwash sidepods, floor with edge wing, tunnel roof and fences, diffuser with strakes, gearbox/crash structure, 4-element front wing, rear wing with DRS pod and swan pylons, beam wing, halo, mirrors, steering wheel, wheels/tyres, and full double-wishbone suspension (`HARDPOINTS`) |
| `src/f1/materials.ts` | PBR materials. Procedural 2×2 twill carbon (albedo, normal, roughness, per-tow anisotropy direction), clearcoat livery paint with the graphic evaluated per pixel, rubber, metals, glass |
| `src/f1/studio.ts` | Procedural HDR studio (emissive softboxes with radiance above 1, prefiltered with PMREM), floor, baked contact shadows |
| `src/f1/viewer.ts` | Renderer, MSAA + GTAO + progressive accumulation + Khronos PBR Neutral tone mapping, orbit controls, camera presets, responsiveness |
| `src/App.tsx` | Minimal UI: loading progress, error state, reset, controls hint |

Key dimensions: 3600 mm wheelbase, 2000 mm overall width, 720 mm tyres on 18" rims
(305 mm front, 405 mm rear), airbox 950 mm, overall length ≈ 5.7 m.

`tools/capture.mjs` is the Playwright script used to render the reference screenshots in `shots/`.

## Rendering notes (honest)

This is a real-time rasterised render with image-based lighting. It is **not** path-traced and
not physically exact. What the implementation actually does:

- Lighting comes from a prefiltered environment cube and one shadowed directional key light.
- Ambient occlusion is screen-space (GTAO).
- Ground contact comes from contact shadows baked once from a depth render beneath the car.
- The "still" mode averages jittered frames. This gives true supersampling, and the penumbra of an
  area-like key light, but it adds no global illumination.
