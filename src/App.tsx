import { useEffect, useRef, useState } from "react";
import { Viewer } from "./f1/viewer";

type Status = { phase: "loading" | "ready" | "error"; label: string; frac: number; error?: string };

export default function App() {
  const mount = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [status, setStatus] = useState<Status>({ phase: "loading", label: "Starting", frac: 0 });
  const [samples, setSamples] = useState<[number, number]>([0, 1]);
  const [help, setHelp] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!mount.current) return;
    const v = new Viewer(mount.current, {
      onProgress: (label, frac) => {
        if (label === "__contextlost__") {
          setStatus({ phase: "error", label: "", frac: 0, error: "The graphics context was lost (GPU reset or memory pressure). Reload to restore the render." });
          return;
        }
        setStatus((s) => (s.phase === "error" ? s : { phase: frac >= 1 ? "ready" : "loading", label, frac }));
      },
      onSamples: (n, max) => setSamples([n, max]),
    });
    viewer.current = v;
    v.init().catch((e: unknown) => {
      console.error(e);
      setStatus({ phase: "error", label: "", frac: 0, error: e instanceof Error ? e.message : String(e) });
    });
    return () => {
      v.dispose();
      viewer.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R") viewer.current?.reset();
      if (e.key === "?" || e.key === "h" || e.key === "H") setHelp((h) => !h);
      if (e.key === "Escape") setHelp(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const refining = status.phase === "ready" && samples[0] > 1 && samples[0] < samples[1];
  const settled = status.phase === "ready" && samples[0] >= samples[1];

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0e0f10] text-neutral-200 select-none">
      <div ref={mount} className="absolute inset-0" />
      {/* soft vignette to keep the eye on the car */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 55%, transparent 55%, rgba(0,0,0,0.38) 100%)" }} />

      {/* wordmark */}
      <div className="pointer-events-none absolute left-5 top-5 sm:left-8 sm:top-7">
        <div className="text-[11px] tracking-[0.35em] text-neutral-400 uppercase">Ground-effect era · Concept</div>
        <div className="mt-1 text-lg sm:text-xl font-light tracking-[0.2em] text-neutral-100">
          ARC<span className="text-[#d9442a]">·</span>26
        </div>
      </div>

      {/* controls */}
      {status.phase === "ready" && (
        <div className="absolute bottom-5 right-5 sm:bottom-7 sm:right-8 flex items-center gap-2">
          <div
            className={`mr-2 text-[10px] tracking-[0.25em] uppercase transition-opacity duration-700 ${refining || settled ? "opacity-60" : "opacity-0"}`}
            title="When the camera is still, frames are accumulated with sub-pixel and area-light jitter for a cleaner still."
          >
            {settled ? "Studio still" : `Refining ${Math.round((samples[0] / samples[1]) * 100)}%`}
          </div>
          <button
            onClick={() => viewer.current?.reset()}
            className="h-9 w-9 grid place-items-center rounded-full border border-white/15 bg-black/30 backdrop-blur hover:bg-white/10 transition"
            title="Reset camera (R)"
            aria-label="Reset camera"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 3v6h6" />
            </svg>
          </button>
          <button
            onClick={() => setHelp((h) => !h)}
            className={`h-9 w-9 grid place-items-center rounded-full border border-white/15 backdrop-blur transition text-sm ${help ? "bg-white/15" : "bg-black/30 hover:bg-white/10"}`}
            title="Controls (?)"
            aria-label="Show controls"
          >
            ?
          </button>
        </div>
      )}

      {help && status.phase === "ready" && (
        <div className="absolute bottom-20 right-5 sm:right-8 w-64 rounded-xl border border-white/10 bg-black/60 backdrop-blur-md p-4 text-[12px] leading-relaxed text-neutral-300 shadow-2xl">
          <div className="mb-2 text-[10px] uppercase tracking-[0.3em] text-neutral-500">Controls</div>
          <Row k="Drag" v="Orbit" />
          <Row k="Scroll / pinch" v="Zoom toward cursor" />
          <Row k="Right-drag / two fingers" v="Pan" />
          <Row k="R  or  ↺" v="Reset to hero view" />
          <div className="mt-3 border-t border-white/10 pt-2 text-[11px] text-neutral-500">
            Hold still and the render refines progressively into a supersampled, soft-shadowed studio still.
          </div>
        </div>
      )}

      {/* loading */}
      {status.phase === "loading" && (
        <div className="absolute inset-0 grid place-items-center bg-[#0e0f10]">
          <div className="w-64">
            <div className="text-center text-[11px] tracking-[0.35em] uppercase text-neutral-500">Building ARC·26</div>
            <div className="mt-4 h-px w-full bg-white/10 overflow-hidden">
              <div className="h-full bg-neutral-200 transition-[width] duration-300" style={{ width: `${Math.round(status.frac * 100)}%` }} />
            </div>
            <div className="mt-3 flex justify-between text-[11px] text-neutral-500">
              <span>{status.label}</span>
              <span className="tabular-nums">{Math.round(status.frac * 100)}%</span>
            </div>
          </div>
        </div>
      )}

      {/* error */}
      {status.phase === "error" && (
        <div className="absolute inset-0 grid place-items-center bg-[#0e0f10] p-6">
          <div className="max-w-md text-center">
            <div className="text-[11px] tracking-[0.35em] uppercase text-[#d9442a]">Render unavailable</div>
            <p className="mt-4 text-sm text-neutral-300 leading-relaxed">{status.error}</p>
            <button
              onClick={() => {
                setStatus({ phase: "loading", label: "Retrying", frac: 0 });
                setAttempt((a) => a + 1);
              }}
              className="mt-6 rounded-full border border-white/20 px-5 py-2 text-xs tracking-widest uppercase hover:bg-white/10"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-neutral-500">{k}</span>
      <span className="text-neutral-200 text-right">{v}</span>
    </div>
  );
}
