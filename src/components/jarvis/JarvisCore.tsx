import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { OrbHandle, OrbMode } from "./JarvisOrb";

/* The Pulse core as a JARVIS-style HUD: counter-rotating rings, a tick dial,
   broken arc segments, a radar sweep, a radial voice waveform, a tilted
   orbit and a small particle mind in the middle.

   Cheap by construction: every static ring is rendered once (glow included)
   into its own bitmap, and a frame just rotates and stamps those bitmaps.
   Only the waveform, sweep, mind and streams are drawn live. Same handle as
   JarvisOrb, so JarvisHome drives it unchanged. */

type Flyer = { sx: number; sy: number; cx: number; cy: number; ex: number; ey: number; t: number; dur: number; delay: number; size: number };
type Beam = { a: number; life: number };

const ICE = "rgba(214,246,255,";
const CYAN = "rgba(80,210,255,";
const BASE = 200; // radius the ring bitmaps are drawn at (px), close to on-screen size so lines stay crisp

/* Speeds are radians per second at rest; modes scale them. */
const MODE: Record<OrbMode, { spin: number; glow: number; wave: number; label: string }> = {
  idle: { spin: 1, glow: 0.55, wave: 0.12, label: "ONLINE" },
  listening: { spin: 1.5, glow: 0.75, wave: 0.35, label: "LISTENING" },
  thinking: { spin: 4.2, glow: 1, wave: 0.25, label: "PROCESSING" },
  speaking: { spin: 1.8, glow: 0.9, wave: 0.9, label: "RESPONDING" },
};

type Layer = { canvas: HTMLCanvasElement; scale: number; speed: number; alpha: number };

function makeLayer(scale: number, draw: (g: CanvasRenderingContext2D, R: number) => void): HTMLCanvasElement {
  const size = Math.ceil(BASE * scale * 2 + 60);
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const g = c.getContext("2d");
  if (!g) return c;
  g.translate(size / 2, size / 2);
  g.shadowColor = CYAN + "0.9)";
  g.shadowBlur = 12;
  g.lineCap = "round";
  draw(g, BASE * scale);
  return c;
}

function arc(g: CanvasRenderingContext2D, R: number, a0: number, a1: number, w: number, alpha: number) {
  g.beginPath();
  g.arc(0, 0, R, a0, a1);
  g.lineWidth = w;
  g.strokeStyle = ICE + alpha + ")";
  g.stroke();
}

const deg = (d: number) => (d * Math.PI) / 180;

function buildLayers(): Layer[] {
  return [
    // Inner ring with four bright brackets.
    { scale: 0.74, speed: 0.55, alpha: 1, canvas: makeLayer(0.74, (g, R) => {
      arc(g, R, 0, Math.PI * 2, 2, 0.7);
      for (let i = 0; i < 4; i++) arc(g, R, deg(i * 90 + 8), deg(i * 90 + 38), 5, 1);
    }) },
    // Tick dial: fine ticks, every fifth longer, every thirtieth brightest.
    { scale: 0.88, speed: -0.16, alpha: 1, canvas: makeLayer(0.88, (g, R) => {
      for (let i = 0; i < 180; i++) {
        const a = deg(i * 2), long = i % 5 === 0, major = i % 30 === 0;
        const len = major ? 16 : long ? 10 : 5;
        g.beginPath();
        g.moveTo(Math.cos(a) * R, Math.sin(a) * R);
        g.lineTo(Math.cos(a) * (R - len), Math.sin(a) * (R - len));
        g.lineWidth = major ? 3.2 : 1.8;
        g.strokeStyle = ICE + (major ? 1 : long ? 0.75 : 0.4) + ")";
        g.stroke();
      }
    }) },
    // Broken heavy segments: the signature arc-reactor ring.
    { scale: 1.02, speed: 0.24, alpha: 1, canvas: makeLayer(1.02, (g, R) => {
      [[0, 42], [58, 118], [134, 146], [160, 238], [252, 262], [276, 334]].forEach(([a, b], i) => {
        arc(g, R, deg(a), deg(b), i % 2 ? 9 : 14, i % 2 ? 0.7 : 0.95);
      });
      arc(g, R - 14, 0, Math.PI * 2, 1.6, 0.5);
    }) },
    // Dashed ring with corner brackets.
    { scale: 1.32, speed: -0.09, alpha: 1, canvas: makeLayer(1.32, (g, R) => {
      g.setLineDash([3, 9]);
      arc(g, R, 0, Math.PI * 2, 3, 0.75);
      g.setLineDash([]);
      for (let i = 0; i < 4; i++) {
        const a = deg(i * 90 + 45);
        arc(g, R + 9, a - deg(9), a + deg(9), 3.4, 1);
      }
    }) },
    // Outer bearing ring with degree marks.
    { scale: 1.56, speed: 0.035, alpha: 0.9, canvas: makeLayer(1.56, (g, R) => {
      arc(g, R, 0, Math.PI * 2, 1.6, 0.55);
      g.shadowBlur = 6;
      g.font = "700 14px 'SF Mono', ui-monospace, Menlo, monospace";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = ICE + "0.75)";
      for (let i = 0; i < 12; i++) {
        const a = deg(i * 30 - 90);
        g.save();
        g.rotate(a + Math.PI / 2);
        g.fillText(String(i * 30).padStart(3, "0"), 0, -R - 14);
        g.restore();
        g.beginPath();
        g.moveTo(Math.cos(a) * R, Math.sin(a) * R);
        g.lineTo(Math.cos(a) * (R + 7), Math.sin(a) * (R + 7));
        g.lineWidth = 2.2;
        g.strokeStyle = ICE + "0.9)";
        g.stroke();
      }
    }) },
  ];
}

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

async function openMic(): Promise<{ level: () => number; stop: () => void } | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ac = new AudioContext();
    const an = ac.createAnalyser();
    an.fftSize = 256;
    ac.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    return {
      level: () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        return Math.min(1, Math.sqrt(sum / buf.length) * 4);
      },
      stop: () => { stream.getTracks().forEach((t) => t.stop()); void ac.close(); },
    };
  } catch {
    return null;
  }
}

const JarvisCore = forwardRef<OrbHandle, { reduced: boolean }>(function JarvisCore({ reduced }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const s = useRef({
    mode: "idle" as OrbMode,
    target: { cx: 0, cy: 0, r: 120 },
    cur: { cx: 0, cy: 0, r: 0 },
    spin: 1, glow: 0.55, wave: 0.12,
    placed: false,
    flyers: [] as Flyer[],
    beams: [] as Beam[],
    mic: null as { level: () => number; stop: () => void } | null,
    micWanted: false,
    level: 0,
  });

  useImperativeHandle(ref, () => ({
    setMode: (m) => { s.current.mode = m; },
    setLayout: (cx, cy, r) => {
      const st = s.current;
      st.target = { cx, cy, r };
      if (!st.placed) { st.cur = { cx, cy, r: r * 0.7 }; st.placed = true; }
    },
    burst: (tx, ty, spread, count = 110) => {
      const st = s.current;
      const { cx, cy, r } = st.cur;
      const a = Math.atan2(ty - cy, tx - cx);
      st.beams.push({ a, life: 1 });
      if (reduced) return;
      const len = Math.hypot(tx - cx, ty - cy);
      for (let i = 0; i < count; i++) {
        const j = a + (Math.random() - 0.5) * 0.5;
        const sx = cx + Math.cos(j) * r * 1.02, sy = cy + Math.sin(j) * r * 1.02;
        const ex = tx + (Math.random() - 0.5) * spread, ey = ty + (Math.random() - 0.5) * spread * 1.2;
        const bend = (Math.random() - 0.5) * len * 0.35;
        st.flyers.push({
          sx, sy, ex, ey, cx: (sx + ex) / 2 - Math.sin(a) * bend, cy: (sy + ey) / 2 + Math.cos(a) * bend,
          t: 0, dur: 480 + Math.random() * 380, delay: Math.random() * 160, size: 1 + Math.random() * 2,
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
        const ex = cx + Math.cos(a) * r * 0.4, ey = cy + Math.sin(a) * r * 0.4;
        st.flyers.push({ sx, sy, ex, ey, cx: (sx + ex) / 2, cy: (sy + ey) / 2, t: 0, dur: 380 + Math.random() * 260, delay: Math.random() * 100, size: 1 + Math.random() * 1.5 });
      }
    },
    setMic: (on) => {
      const st = s.current;
      st.micWanted = on;
      if (on && !st.mic) void openMic().then((m) => { if (st.micWanted) st.mic = m; else m?.stop(); });
      if (!on && st.mic) { st.mic.stop(); st.mic = null; }
    },
  }), [reduced]);

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const layers = buildLayers();
    const dot = sprite(CYAN + "0.9)");

    // The mind: a small 3D point sphere in the middle.
    const MIND = 260;
    const mind = new Float32Array(MIND * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < MIND; i++) {
      const y = 1 - (i / (MIND - 1)) * 2, rad = Math.sqrt(1 - y * y), th = golden * i;
      mind[i * 3] = Math.cos(th) * rad; mind[i * 3 + 1] = y; mind[i * 3 + 2] = Math.sin(th) * rad;
    }

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

    const angles = layers.map(() => Math.random() * Math.PI * 2);
    let sweep = 0, orbit = 0, mindYaw = 0, t = 0;
    let raf = 0, last = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const st = s.current;
      const busy = st.flyers.length > 0 || st.beams.length > 0 || st.mode !== "idle" || !!st.mic
        || Math.abs(st.target.r - st.cur.r) > 0.5 || Math.abs(st.target.cx - st.cur.cx) > 0.5;
      if (now - last < (busy ? 15 : 32)) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;

      const m = MODE[st.mode];
      const k = 1 - Math.exp(-dt * 3);
      st.spin += (m.spin * (reduced ? 0.25 : 1) - st.spin) * k;
      st.glow += (m.glow - st.glow) * k;
      const voice = st.mode === "speaking" ? (0.5 + 0.5 * Math.sin(t * 11)) * (0.5 + 0.5 * Math.sin(t * 3.3 + 1)) : 0;
      const micLevel = st.mic ? st.mic.level() : 0;
      st.level += (Math.max(m.wave * 0.4 + voice * m.wave, micLevel) - st.level) * Math.min(1, dt * 12);
      const kl = 1 - Math.exp(-dt * 4);
      st.cur.cx += (st.target.cx - st.cur.cx) * kl;
      st.cur.cy += (st.target.cy - st.cur.cy) * kl;
      st.cur.r += (st.target.r - st.cur.r) * kl;
      const { cx, cy, r } = st.cur;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Projector haze behind the HUD.
      // A dark field local to the dial, like the throw of a projector,
      // so the glow reads as light against the pale wallpaper.
      const haze = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.95);
      haze.addColorStop(0, "rgba(2,10,30,0.72)");
      haze.addColorStop(0.55, "rgba(3,14,40,0.55)");
      haze.addColorStop(0.82, "rgba(4,18,50,0.22)");
      haze.addColorStop(1, "rgba(4,18,50,0)");
      ctx.fillStyle = haze;
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.95, 0, Math.PI * 2); ctx.fill();

      ctx.globalCompositeOperation = "lighter";

      // Static rings: rotate and stamp.
      const unit = r / BASE;
      layers.forEach((L, i) => {
        angles[i] += L.speed * st.spin * dt * (st.mode === "thinking" && i % 2 ? -1.6 : 1);
        const size = L.canvas.width * unit;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angles[i]);
        ctx.globalAlpha = L.alpha * (0.7 + 0.3 * st.glow) * (st.mode === "thinking" && i === 2 ? 0.75 + 0.25 * Math.sin(t * 18) : 1);
        ctx.drawImage(L.canvas, -size / 2, -size / 2, size, size);
        ctx.restore();
      });

      // Radar sweep between the inner ring and the dashed ring.
      sweep += dt * (0.9 + st.spin * 0.5);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(sweep);
      for (let i = 0; i < 14; i++) {
        const a0 = -i * 0.045, a1 = a0 - 0.045;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.28, a1, a0);
        ctx.arc(0, 0, r * 0.76, a0, a1, true);
        ctx.closePath();
        ctx.fillStyle = CYAN + ((0.22 * (1 - i / 14)) * st.glow).toFixed(3) + ")";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(r * 0.76, 0); ctx.lineTo(r * 1.28, 0);
      ctx.lineWidth = 1.6; ctx.strokeStyle = ICE + (0.8 * st.glow).toFixed(3) + ")";
      ctx.stroke();
      ctx.restore();

      // Voice waveform: radial bars just outside the heavy ring.
      const BARS = 96;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.lineWidth = Math.max(1.8, r * 0.016);
      for (let i = 0; i < BARS; i++) {
        const a = (i / BARS) * Math.PI * 2;
        const n = 0.5 + 0.5 * Math.sin(i * 0.9 + t * 7) * Math.sin(i * 0.37 - t * 4.3);
        const len = r * (0.03 + st.level * 0.22 * n);
        const r0 = r * 1.1;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        ctx.lineTo(Math.cos(a) * (r0 + len), Math.sin(a) * (r0 + len));
        ctx.strokeStyle = ICE + (0.35 + 0.55 * n * Math.min(1, st.level * 2 + 0.2)).toFixed(3) + ")";
        ctx.stroke();
      }
      ctx.restore();

      // Tilted 3D orbit with a travelling node.
      orbit += dt * 0.7 * st.spin;
      const tiltA = 1.15, tiltB = t * 0.12;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(tiltB);
      ctx.scale(1, Math.cos(tiltA));
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = ICE + "0.5)";
      ctx.stroke();
      ctx.restore();
      {
        const ox = Math.cos(orbit) * r * 1.2, oy = Math.sin(orbit) * r * 1.2 * Math.cos(tiltA);
        const px = cx + ox * Math.cos(tiltB) - oy * Math.sin(tiltB), py = cy + ox * Math.sin(tiltB) + oy * Math.cos(tiltB);
        ctx.globalAlpha = 1;
        ctx.drawImage(dot, px - 7, py - 7, 14, 14);
      }

      // Core glow.
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.62);
      core.addColorStop(0, "rgba(220,248,255," + (0.55 * st.glow + st.level * 0.3).toFixed(3) + ")");
      core.addColorStop(0.35, CYAN + (0.28 * st.glow).toFixed(3) + ")");
      core.addColorStop(1, "rgba(0,60,140,0)");
      ctx.globalAlpha = 1;
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2); ctx.fill();

      // The mind: a rotating point sphere inside the core.
      mindYaw += dt * (0.4 + st.spin * 0.25);
      const cyw = Math.cos(mindYaw), syw = Math.sin(mindYaw), tilt = 0.4, ct = Math.cos(tilt), stl = Math.sin(tilt);
      const mr = r * (0.42 + st.level * 0.05);
      for (let i = 0; i < MIND; i++) {
        const x = mind[i * 3], y = mind[i * 3 + 1], z = mind[i * 3 + 2];
        const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
        const y2 = y * ct - z1 * stl, z2 = y * stl + z1 * ct;
        const d = (z2 + 1) / 2;
        const size = 1.6 + 2.8 * d;
        ctx.globalAlpha = 0.15 + 0.75 * d * d;
        ctx.drawImage(dot, cx + x1 * mr - size, cy + y2 * mr - size, size * 2, size * 2);
      }

      // Beams toward panels being opened.
      for (const b of st.beams) {
        b.life -= dt * 1.8;
        if (b.life <= 0) continue;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(b.a);
        const grd = ctx.createLinearGradient(r * 0.4, 0, r * 2.2, 0);
        grd.addColorStop(0, ICE + (0.9 * b.life).toFixed(3) + ")");
        grd.addColorStop(1, CYAN + "0)");
        ctx.globalAlpha = 1;
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(r * 0.4, -2); ctx.lineTo(r * 2.2, -r * 0.18); ctx.lineTo(r * 2.2, r * 0.18); ctx.lineTo(r * 0.4, 2);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      st.beams = st.beams.filter((b) => b.life > 0);

      // Streams.
      const dms = dt * 1000;
      for (const f of st.flyers) {
        f.t += dms;
        const p = (f.t - f.delay) / f.dur;
        if (p <= 0 || p >= 1) continue;
        const e = 1 - Math.pow(1 - p, 3);
        for (let tr = 0; tr < 3; tr++) {
          const q = Math.max(0, e - tr * 0.04), iq = 1 - q;
          const px = iq * iq * f.sx + 2 * iq * q * f.cx + q * q * f.ex;
          const py = iq * iq * f.sy + 2 * iq * q * f.cy + q * q * f.ey;
          const size = f.size * (1 - tr * 0.25) * 2;
          ctx.globalAlpha = (1 - p * 0.5) * (1 - tr * 0.3);
          ctx.drawImage(dot, px - size, py - size, size * 2, size * 2);
        }
      }
      st.flyers = st.flyers.filter((f) => f.t < f.delay + f.dur);

      // Status readout under the dial.
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.85;
      ctx.font = "600 " + Math.max(9, Math.round(r * 0.07)) + "px 'SF Mono', ui-monospace, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(214,246,255,.9)";
      ctx.shadowColor = "rgba(80,210,255,.9)";
      ctx.shadowBlur = 8;
      const blink = st.mode === "idle" || Math.sin(t * 8) > -0.3;
      if (blink) ctx.fillText("PULSE  ·  " + m.label, cx, cy + r * 1.8);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    };

    let visible = true;
    const start = () => { if (!raf && visible && !document.hidden) { last = performance.now() - 40; raf = requestAnimationFrame(frame); } };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); else stop(); });
    io.observe(cv);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    start();
    return () => {
      stop(); ro.disconnect(); io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      s.current.mic?.stop(); s.current.mic = null;
    };
  }, [reduced]);

  return <canvas ref={canvasRef} aria-hidden="true" className="jv-canvas" />;
});

export default JarvisCore;
