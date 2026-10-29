import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import GeneratingOrb from "../ui/generating-orb";
import { openMic, type OrbHandle, type OrbMode } from "./JarvisOrb";

/* The Pulse core: a generating orb (soft lit sphere, rim light sweeping round)
   with a word inside saying what Pulse is doing right now. Placed and scaled
   from a rAF loop (transform only); a full-stage canvas carries the particles
   that stream out to panels when they open and back in when they fold.
   Same handle as JarvisOrb, so JarvisHome drives it unchanged:
   - mode sets how fast the rim sweeps and the letters wave;
   - the voice (mic, or a speaking cadence) makes the orb breathe;
   - a burst leans it toward the panel it is sending to. */

/** The orb's layout size before scaling. */
const BASE = 240;
/** Orb radius as a multiple of the layout radius r the parent passes. */
const REACH = 0.95;

const SPEED: Record<OrbMode, number> = { idle: 0.8, listening: 1.4, thinking: 2.6, speaking: 1.8 };

type Flyer = { sx: number; sy: number; cx: number; cy: number; ex: number; ey: number; t: number; dur: number; delay: number; size: number; warm: boolean };

function sprite(color: string): HTMLCanvasElement {
  const S = 32, c = document.createElement("canvas");
  c.width = S; c.height = S;
  const g = c.getContext("2d");
  if (!g) return c;
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.3, color);
  gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return c;
}

type Props = { reduced: boolean; word: string; mode: OrbMode };

const PulseArt = forwardRef<OrbHandle, Props>(function PulseArt({ reduced, word, mode }, ref) {
  const orbRef = useRef<HTMLDivElement>(null);
  const streamsRef = useRef<HTMLCanvasElement>(null);
  const s = useRef({
    mode: "idle" as OrbMode,
    target: { cx: 0, cy: 0, r: 120 },
    cur: { cx: 0, cy: 0, r: 0 },
    clock: 0, voice: 0,
    lean: { x: 0, y: 0 }, kick: 0,
    flyers: [] as Flyer[],
    placed: false,
    mic: null as { level: () => number; stop: () => void } | null,
    micWanted: false,
    paintNow: null as null | (() => void),
  });

  useImperativeHandle(ref, () => ({
    setMode: (m) => { s.current.mode = m; },
    setLayout: (cx, cy, r) => {
      const st = s.current;
      st.target = { cx, cy, r };
      if (!st.placed) { st.cur = { cx, cy, r: r * 0.7 }; st.placed = true; st.paintNow?.(); }
    },
    burst: (tx, ty, spread, count = 110) => {
      const st = s.current;
      const { cx, cy, r } = st.cur;
      const dx = tx - cx, dy = ty - cy, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      st.lean.x += ux * r * 0.06;
      st.lean.y += uy * r * 0.06;
      st.kick = Math.min(1, st.kick + 0.7);
      if (reduced) return;
      const edge = r * REACH;
      for (let i = 0; i < count; i++) {
        const a = (Math.random() - 0.5) * 1.1;
        const ox = ux * Math.cos(a) - uy * Math.sin(a), oy = ux * Math.sin(a) + uy * Math.cos(a);
        const sx = cx + ox * edge * (0.9 + Math.random() * 0.12), sy = cy + oy * edge * (0.9 + Math.random() * 0.12);
        const ex = tx + (Math.random() - 0.5) * spread, ey = ty + (Math.random() - 0.5) * spread * 1.2;
        const bend = (Math.random() - 0.5) * len * 0.45;
        st.flyers.push({
          sx, sy, ex, ey, cx: (sx + ex) / 2 - uy * bend, cy: (sy + ey) / 2 + ux * bend,
          t: 0, dur: 560 + Math.random() * 420, delay: Math.random() * 200,
          size: 1.3 + Math.random() * 2.2, warm: Math.random() < 0.25,
        });
      }
    },
    absorb: (fx, fy, spread, count = 70) => {
      const st = s.current;
      if (reduced) return;
      const { cx, cy, r } = st.cur;
      for (let i = 0; i < count; i++) {
        const sx = fx + (Math.random() - 0.5) * spread, sy = fy + (Math.random() - 0.5) * spread * 1.2;
        const a = Math.random() * Math.PI * 2;
        const ex = cx + Math.cos(a) * r * REACH * 0.9, ey = cy + Math.sin(a) * r * REACH * 0.9;
        const bend = (Math.random() - 0.5) * 120;
        st.flyers.push({ sx, sy, ex, ey, cx: (sx + ex) / 2 + bend, cy: (sy + ey) / 2 - bend, t: 0, dur: 440 + Math.random() * 300, delay: Math.random() * 120, size: 1 + Math.random() * 1.6, warm: false });
      }
    },
    setMic: (on) => {
      const st = s.current;
      st.micWanted = on;
      if (!on) { st.mic?.stop(); st.mic = null; return; }
      if (st.mic) return;
      void openMic().then((m) => {
        if (!m) return;
        if (st.micWanted && !st.mic) st.mic = m; else m.stop();
      });
    },
  }), [reduced]);

  useEffect(() => {
    const orb = orbRef.current, cv = streamsRef.current;
    const ctx = cv?.getContext("2d");
    if (!orb || !cv || !ctx) return;
    const ice = sprite("rgba(130,180,255,.95)");
    const violet = sprite("rgba(160,130,255,.95)");

    let w = 0, h = 0, dpr = 1;
    const fit = () => {
      const box = cv.getBoundingClientRect();
      dpr = Math.min(1.25, window.devicePixelRatio || 1);
      w = box.width; h = box.height;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);

    const paint = (dt: number) => {
      const st = s.current;
      const kl = 1 - Math.exp(-dt * 4);
      st.cur.cx += (st.target.cx - st.cur.cx) * kl;
      st.cur.cy += (st.target.cy - st.cur.cy) * kl;
      st.cur.r += (st.target.r - st.cur.r) * kl;
      const decay = Math.exp(-dt * 2.4);
      st.kick *= decay; st.lean.x *= decay; st.lean.y *= decay;
      st.clock += dt * (reduced ? 0 : 1);

      let v = 0;
      if (st.mic) v = st.mic.level();
      else if (st.mode === "speaking") v = (Math.sin(st.clock * 11) * 0.5 + 0.5) * (Math.sin(st.clock * 3.1) * 0.5 + 0.5);
      st.voice += (v - st.voice) * (1 - Math.exp(-dt * 10));

      const { cx, cy, r } = st.cur;
      const breathe = reduced ? 1 : 1 + 0.012 * Math.sin(st.clock * 1.4) + st.voice * 0.06 + st.kick * 0.04;
      const scale = ((2 * REACH * r) / BASE) * breathe;
      orb.style.transform = `translate(${(cx + st.lean.x - BASE / 2).toFixed(2)}px,${(cy + st.lean.y - BASE / 2).toFixed(2)}px) scale(${scale.toFixed(4)})`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!st.flyers.length) return;
      ctx.globalCompositeOperation = "lighter";
      const dms = dt * 1000;
      for (const f of st.flyers) {
        f.t += dms;
        const p = (f.t - f.delay) / f.dur;
        if (p <= 0 || p >= 1) continue;
        const e = 1 - Math.pow(1 - p, 3);
        for (let tr = 0; tr < 5; tr++) {
          const q = Math.max(0, e - tr * 0.03), iq = 1 - q;
          const px = iq * iq * f.sx + 2 * iq * q * f.cx + q * q * f.ex;
          const py = iq * iq * f.sy + 2 * iq * q * f.cy + q * q * f.ey;
          const size = f.size * (1 - tr * 0.17);
          ctx.globalAlpha = (1 - p * 0.55) * (1 - tr * 0.2);
          ctx.drawImage(f.warm ? violet : ice, px - size, py - size, size * 2, size * 2);
        }
      }
      st.flyers = st.flyers.filter((f) => f.t < f.delay + f.dur);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };
    s.current.paintNow = () => paint(0);
    if (s.current.placed) paint(0);

    let raf = 0, last = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 15) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      paint(dt);
    };
    let visible = true;
    const start = () => { if (!raf && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); else stop(); });
    io.observe(cv);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    start();
    return () => {
      stop(); ro.disconnect(); io.disconnect(); document.removeEventListener("visibilitychange", onVis);
      s.current.paintNow = null;
      s.current.mic?.stop(); s.current.mic = null;
    };
  }, [reduced]);

  return (
    <>
      <div ref={orbRef} className="jv-art" style={{ width: BASE, height: BASE }}>
        <GeneratingOrb
          size={BASE}
          depth={1}
          speed={SPEED[mode]}
          duration={2000}
          stagger={90}
          pop={1.15}
          restOpacity={0.7}
          textSize={1}
          text={word}
          highlightColor="#f7f9ff"
          haloColor="#4a86ff"
          coreColor="#6a5cff"
          haloColorAlt="#8f6bff"
          coreColorAlt="#2f6cf0"
          accentColor="#ff8ad8"
          textColor="#ffffff"
          playback={reduced ? "pause" : "play"}
        />
      </div>
      <canvas ref={streamsRef} aria-hidden="true" className="jv-canvas" />
    </>
  );
});

export default PulseArt;
