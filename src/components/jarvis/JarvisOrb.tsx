import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/* The Pulse core: one glowing dot with smaller dots orbiting it on tilted
   paths, drawn on a canvas that covers the whole stage so streams can fly
   out to panels. Everything runs in a rAF loop off React state: the parent
   drives it through the imperative handle (mode, layout, bursts, mic). */

export type OrbMode = "idle" | "listening" | "thinking" | "speaking";

export type OrbHandle = {
  setMode: (m: OrbMode) => void;
  setLayout: (cx: number, cy: number, r: number) => void;
  /** Lean toward a point and stream particles into it. */
  burst: (tx: number, ty: number, spread: number, count?: number) => void;
  /** Pull particles back in from a point (panels folding away). */
  absorb: (fx: number, fy: number, spread: number, count?: number) => void;
  /** While on, the core follows the real microphone level. */
  setMic: (on: boolean) => void;
};

type Flyer = { sx: number; sy: number; cx: number; cy: number; ex: number; ey: number; t: number; dur: number; delay: number; size: number; hot: boolean };

/* Orbits, as multiples of the layout radius r. Each carries a few dots with short trails. */
const ORBITS = [
  { radius: 0.5,  tiltX: 1.2,  tiltZ: 0.4,  speed: 1.1,   dots: 2, size: 4.6 },
  { radius: 0.78, tiltX: 1.32, tiltZ: -0.7, speed: -0.72, dots: 3, size: 4 },
  { radius: 1.05, tiltX: 1.05, tiltZ: 1.25, speed: 0.46,  dots: 4, size: 3.4 },
];
/* A loose swarm of fine dots on a wide, nearly flat ring. */
const DUST = 34;
const TRAIL = 7;

const MODE: Record<OrbMode, { speed: number; spread: number; glow: number }> = {
  idle:      { speed: 1,   spread: 1,    glow: 0.55 },
  listening: { speed: 1.4, spread: 1.06, glow: 0.7 },
  thinking:  { speed: 3,   spread: 0.86, glow: 0.85 },
  speaking:  { speed: 1.6, spread: 1.02, glow: 0.8 },
};

function sprite(color: string): HTMLCanvasElement {
  const S = 32, c = document.createElement("canvas");
  c.width = S; c.height = S;
  const g = c.getContext("2d");
  if (!g) return c;
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.25, color);
  gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return c;
}

export async function openMic(): Promise<{ level: () => number; stop: () => void } | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ac = new AudioContext();
    const an = ac.createAnalyser();
    an.fftSize = 512;
    an.smoothingTimeConstant = 0.3;
    const src = ac.createMediaStreamSource(stream);
    src.connect(an);
    const data = new Uint8Array(an.frequencyBinCount);
    return {
      level() {
        an.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) { const v = data[i] / 255; sum += v * v; }
        return Math.min(Math.sqrt(sum / data.length) * 4.5, 1);
      },
      stop() { stream.getTracks().forEach((t) => t.stop()); src.disconnect(); void ac.close(); },
    };
  } catch {
    return null;
  }
}

const JarvisOrb = forwardRef<OrbHandle, { reduced: boolean }>(function JarvisOrb({ reduced }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const s = useRef({
    mode: "idle" as OrbMode,
    target: { cx: 0, cy: 0, r: 120 },
    cur: { cx: 0, cy: 0, r: 0 },
    speed: 1, spread: 1, glow: MODE.idle.glow,
    phase: 0, t: 0, kick: 0, voice: 0,
    lean: { x: 0, y: 0 },
    flyers: [] as Flyer[],
    placed: false,
    mic: null as { level: () => number; stop: () => void } | null,
    micWanted: false,
    /** Draws one frame now; set once the render loop is mounted. */
    paintNow: null as null | (() => void),
  });

  useImperativeHandle(ref, () => ({
    setMode: (m) => { s.current.mode = m; },
    setLayout: (cx, cy, r) => {
      const st = s.current;
      st.target = { cx, cy, r };
      if (!st.placed) { st.cur = { cx, cy, r: r * 0.6 }; st.placed = true; st.paintNow?.(); }
    },
    burst: (tx, ty, spread, count = 110) => {
      const st = s.current;
      const { cx, cy, r } = st.cur;
      const dx = tx - cx, dy = ty - cy, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      // The core leans toward the panel and flares as it sends.
      st.lean.x += ux * r * 0.1;
      st.lean.y += uy * r * 0.1;
      st.kick = Math.min(1, st.kick + 0.6);
      if (reduced) return;
      for (let i = 0; i < count; i++) {
        const a = (Math.random() - 0.5) * 1.3;
        const ox = ux * Math.cos(a) - uy * Math.sin(a), oy = ux * Math.sin(a) + uy * Math.cos(a);
        const sx = cx + ox * r * (0.3 + Math.random() * 0.7), sy = cy + oy * r * (0.3 + Math.random() * 0.7);
        const ex = tx + (Math.random() - 0.5) * spread, ey = ty + (Math.random() - 0.5) * spread * 1.2;
        const bend = (Math.random() - 0.5) * len * 0.5;
        st.flyers.push({
          sx, sy, ex, ey,
          cx: (sx + ex) / 2 - uy * bend, cy: (sy + ey) / 2 + ux * bend,
          t: 0, dur: 520 + Math.random() * 420, delay: Math.random() * 180,
          size: 1.2 + Math.random() * 2.2, hot: Math.random() < 0.18,
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
        const ex = cx + Math.cos(a) * r * 0.2, ey = cy + Math.sin(a) * r * 0.2;
        const bend = (Math.random() - 0.5) * 120;
        st.flyers.push({ sx, sy, ex, ey, cx: (sx + ex) / 2 + bend, cy: (sy + ey) / 2 - bend, t: 0, dur: 420 + Math.random() * 300, delay: Math.random() * 120, size: 1 + Math.random() * 1.8, hot: false });
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
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;

    const cool = sprite("rgba(110,200,255,.9)");
    const hot = sprite("rgba(190,235,255,.95)");
    // Orbiting dots use a brighter, whiter sprite so they read on the light wallpaper.
    const bright = sprite("rgba(235,247,255,1)");

    // Fixed per-dot offsets so the dust never lines up.
    const dust = Array.from({ length: DUST }, (_, i) => ({
      a: (i / DUST) * Math.PI * 2 + Math.random() * 0.3,
      rr: 1.18 + Math.random() * 0.3,
      sp: 0.12 + Math.random() * 0.1,
      tw: Math.random() * Math.PI * 2,
    }));

    let w = 0, h = 0, dpr = 1;
    const fit = () => {
      const box = cv.getBoundingClientRect();
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      w = box.width; h = box.height;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);

    // Project a point on a tilted circle to screen space; z in -1..1 (1 = front).
    const orbitPoint = (o: typeof ORBITS[number], a: number, cx: number, cy: number, r: number) => {
      const cT = Math.cos(o.tiltX), sT = Math.sin(o.tiltX), cZ = Math.cos(o.tiltZ), sZ = Math.sin(o.tiltZ);
      const x = Math.cos(a), z = Math.sin(a);
      const y1 = -z * sT, z1 = z * cT;
      const x2 = x * cZ - y1 * sZ, y2 = x * sZ + y1 * cZ;
      const sc = 1 + z1 * 0.16;
      return { x: cx + x2 * o.radius * r * sc, y: cy + y2 * o.radius * r * sc, z: z1 };
    };

    let raf = 0, last = performance.now();
    const paint = (dt: number) => {
      const st = s.current;
      const motion = reduced ? 0 : 1;
      st.t += dt * motion;
      const t = st.t;

      const m = MODE[st.mode];
      const k = 1 - Math.exp(-dt * 3.2);
      st.speed += (m.speed - st.speed) * k;
      st.spread += (m.spread - st.spread) * k;
      st.glow += (m.glow - st.glow) * k;
      const kl = 1 - Math.exp(-dt * 4);
      st.cur.cx += (st.target.cx - st.cur.cx) * kl;
      st.cur.cy += (st.target.cy - st.cur.cy) * kl;
      st.cur.r += (st.target.r - st.cur.r) * kl;
      const decay = Math.exp(-dt * 2.4);
      st.kick *= decay;
      st.lean.x *= decay;
      st.lean.y *= decay;

      // Voice: the real mic while it is open, otherwise a speaking cadence.
      let v = 0;
      if (st.mic) v = st.mic.level();
      else if (st.mode === "speaking") v = (Math.sin(t * 13) * 0.5 + 0.5) * (Math.sin(t * 3.7) * 0.5 + 0.5);
      st.voice += (v - st.voice) * (1 - Math.exp(-dt * 12));
      st.phase += dt * motion * st.speed * (1 + st.voice * 0.8);

      const cx = st.cur.cx + st.lean.x, cy = st.cur.cy + st.lean.y;
      const r = st.cur.r * st.spread;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (r < 1) return;

      // Faint orbit paths.
      ctx.lineWidth = 1;
      for (const o of ORBITS) {
        ctx.beginPath();
        for (let i = 0; i <= 64; i++) {
          const p = orbitPoint(o, (i / 64) * Math.PI * 2, cx, cy, r);
          if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
        }
        ctx.strokeStyle = "rgba(235,245,255,.22)";
        ctx.stroke();
      }

      ctx.globalCompositeOperation = "lighter";

      // Dust ring, back half then front half around the core.
      const dustAt = (d: typeof dust[number]) => {
        const a = d.a + st.phase * d.sp;
        const x = Math.cos(a) * d.rr, z = Math.sin(a) * d.rr;
        return { x: cx + x * r, y: cy + z * r * 0.28 - x * r * 0.08, z: Math.sin(a) };
      };
      const drawDust = (front: boolean) => {
        for (const d of dust) {
          const p = dustAt(d);
          if ((p.z > 0) !== front) continue;
          ctx.globalAlpha = (0.18 + 0.4 * (p.z + 1) / 2) * (0.7 + 0.3 * Math.sin(t * 2 + d.tw));
          const size = 1.6 + (p.z + 1) * 0.8;
          ctx.drawImage(cool, p.x - size, p.y - size, size * 2, size * 2);
        }
      };
      // Orbiting dots with short trails, back or front of the core.
      const drawOrbits = (front: boolean) => {
        for (const o of ORBITS) {
          for (let j = 0; j < o.dots; j++) {
            const a0 = (j / o.dots) * Math.PI * 2 + st.phase * o.speed;
            const head = orbitPoint(o, a0, cx, cy, r);
            if ((head.z > 0) !== front) continue;
            for (let tr = TRAIL - 1; tr >= 0; tr--) {
              const p = tr ? orbitPoint(o, a0 - Math.sign(o.speed) * tr * 0.07, cx, cy, r) : head;
              const depth = (p.z + 1) / 2;
              const size = o.size * (0.75 + 0.5 * depth) * (1 - tr / TRAIL * 0.7);
              ctx.globalAlpha = (0.25 + 0.75 * depth) * (1 - tr / TRAIL);
              ctx.drawImage(tr ? cool : bright, p.x - size, p.y - size, size * 2, size * 2);
            }
          }
        }
      };

      drawDust(false);
      drawOrbits(false);

      // The core: a soft halo and a bright dot that swells with the voice.
      const cr = r * 0.16 * (1 + st.voice * 0.35 + st.kick * 0.25 + Math.sin(t * 1.6) * 0.04);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 5);
      halo.addColorStop(0, "rgba(120,200,255," + (0.42 * st.glow + st.kick * 0.2).toFixed(3) + ")");
      halo.addColorStop(0.35, "rgba(40,120,255," + (0.16 * st.glow).toFixed(3) + ")");
      halo.addColorStop(1, "rgba(20,60,160,0)");
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(cx, cy, cr * 5, 0, Math.PI * 2); ctx.fill();
      const dot = ctx.createRadialGradient(cx - cr * 0.3, cy - cr * 0.35, 0, cx, cy, cr);
      dot.addColorStop(0, "#ffffff");
      dot.addColorStop(0.45, "#bfe4ff");
      dot.addColorStop(1, "#3d8bff");
      ctx.fillStyle = dot;
      ctx.shadowColor = "rgba(90,180,255,.9)";
      ctx.shadowBlur = cr * 1.2;
      ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;

      ctx.globalCompositeOperation = "lighter";
      drawOrbits(true);
      drawDust(true);

      // Streams.
      const dms = dt * 1000;
      for (const f of st.flyers) {
        f.t += dms;
        const p = (f.t - f.delay) / f.dur;
        if (p <= 0 || p >= 1) continue;
        const e = 1 - Math.pow(1 - p, 3);
        for (let tr = 0; tr < 4; tr++) {
          const q = Math.max(0, e - tr * 0.035), iq = 1 - q;
          const px = iq * iq * f.sx + 2 * iq * q * f.cx + q * q * f.ex;
          const py = iq * iq * f.sy + 2 * iq * q * f.cy + q * q * f.ey;
          const size = f.size * (1 - tr * 0.22);
          ctx.globalAlpha = (1 - p * 0.6) * (1 - tr * 0.24);
          ctx.drawImage(f.hot ? hot : cool, px - size, py - size, size * 2, size * 2);
        }
      }
      st.flyers = st.flyers.filter((f) => f.t < f.delay + f.dur);

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };

    s.current.paintNow = () => paint(0);
    if (s.current.placed) paint(0);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 15) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      paint(dt);
    };
    // Stop entirely when the tab is hidden or the canvas is off screen.
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

  return <canvas ref={canvasRef} aria-hidden="true" className="jv-canvas" />;
});

export default JarvisOrb;
