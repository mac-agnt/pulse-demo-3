/* The particle presence: a few thousand fine dots that form Pulse.

   Runs entirely outside React. Each frame the engine works out a target for
   every dot from the current scene (the central presence, one small cluster
   per real background task, outlines around panels that are emerging) and
   moves dots toward their targets with a critically damped spring, so shape
   changes settle in roughly 400–600 ms without overshoot. Positions live in
   typed arrays; drawing is a single WebGL point batch, with a Canvas 2D
   fallback. Density and resolution drop on weaker devices, rendering stops
   while hidden, and reduced motion snaps dots to their targets. */

import type { Activity } from "../types";

export type Rect = { x: number; y: number; w: number; h: number };

export type Scene = {
  activity: Activity;
  /** Where the presence sits and how big it is (CSS px within the canvas). */
  presence: { cx: number; cy: number; r: number };
  /** One cluster per real background task. */
  clusters: { id: string; cx: number; cy: number; status: "working" | "waiting" | "done" | "failed" }[];
  /** Panels currently emerging; dots trace their edge, then return. */
  outlines: { id: string; rect: Rect; born: number }[];
};

export type Levels = { mic: () => number; out: () => number };

type Palette = { base: [number, number, number]; accent: [number, number, number]; ok: [number, number, number]; warn: [number, number, number]; bad: [number, number, number] };

const OUTLINE_MS = 950;

function readColor(el: Element, name: string, fallback: [number, number, number]): [number, number, number] {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(v);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const VS = `
attribute vec2 aPos; attribute float aSize; attribute vec4 aCol;
uniform vec2 uRes; uniform float uDpr;
varying vec4 vCol;
void main(){
  vec2 p = aPos / uRes * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
  gl_PointSize = aSize * uDpr;
  vCol = aCol;
}`;
const FS = `
precision mediump float;
varying vec4 vCol;
void main(){
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float a = smoothstep(1.0, 0.15, d);
  gl_FragColor = vec4(vCol.rgb * a * vCol.a, a * vCol.a);
}`;

export class ParticleField {
  private n: number;
  private pos: Float32Array; private vel: Float32Array;
  private seed: Float32Array; private shell: Float32Array;
  private out: Float32Array;
  private gl: WebGLRenderingContext | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private buf: WebGLBuffer | null = null;
  private uRes: WebGLUniformLocation | null = null;
  private uDpr: WebGLUniformLocation | null = null;
  private dpr = 1; private w = 0; private h = 0;
  private raf = 0; private last = 0; private t = 0;
  private visible = true;
  private scene: Scene;
  private palette: Palette;
  private flash = 0; private lastActivity: Activity = "idle";
  private slowFrames = 0;
  readonly renderer: "webgl" | "canvas2d" | "none";

  constructor(private canvas: HTMLCanvasElement, private levels: Levels, private reduced: boolean) {
    const weak = (navigator.hardwareConcurrency ?? 8) <= 4 || ((navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
    this.n = weak ? 900 : 1800;
    this.dpr = Math.min(weak ? 1 : 1.5, window.devicePixelRatio || 1);
    this.pos = new Float32Array(this.n * 2);
    this.vel = new Float32Array(this.n * 2);
    this.seed = new Float32Array(this.n * 4);
    this.shell = new Float32Array(this.n * 3);
    this.out = new Float32Array(this.n * 7);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < this.n; i++) {
      const y = 1 - (i / (this.n - 1)) * 2, rad = Math.sqrt(1 - y * y), th = golden * i;
      this.shell.set([Math.cos(th) * rad, y, Math.sin(th) * rad], i * 3);
      this.seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }
    this.scene = { activity: "idle", presence: { cx: 0, cy: 0, r: 100 }, clusters: [], outlines: [] };
    this.palette = {
      base: [0.88, 0.94, 1], accent: readColor(canvas, "--accent", [0.04, 0.52, 1]),
      ok: readColor(canvas, "--ok", [0.19, 0.82, 0.35]), warn: readColor(canvas, "--warn", [1, 0.62, 0.04]), bad: readColor(canvas, "--bad", [1, 0.27, 0.23]),
    };
    this.renderer = this.initGl() ? "webgl" : (this.ctx2d = canvas.getContext("2d")) ? "canvas2d" : "none";
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
    this.resize();
  }

  setScene(next: Scene) {
    const first = this.scene.presence.r === 100 && this.scene.presence.cx === 0;
    if (next.activity === "completed" && this.lastActivity !== "completed") this.flash = 1;
    this.lastActivity = next.activity;
    this.scene = next;
    if (first) this.snap();
    if (this.raf === 0) this.requestFrame();
  }

  setVisible(v: boolean) { this.visible = v; if (v) this.requestFrame(); else this.stop(); }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(this.w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * this.dpr));
    this.gl?.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  destroy() {
    this.stop();
    this.canvas.removeEventListener("webglcontextlost", this.onLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onRestored);
    // Free our buffer but keep the context alive: the same canvas may get a new engine.
    if (this.gl && !this.gl.isContextLost()) this.gl.deleteBuffer(this.buf);
  }

  /* The browser can drop a WebGL context (GPU reset, too many contexts).
     Stop drawing until it comes back, then rebuild. */
  private onLost = (e: Event) => { e.preventDefault(); this.stop(); };
  private onRestored = () => { this.gl = null; this.initGl(); this.resize(); this.requestFrame(); };

  private initGl(): boolean {
    const gl = this.canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false });
    if (!gl || gl.isContextLost()) return false;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
    const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return false;
    const p = gl.createProgram()!;
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return false;
    gl.useProgram(p);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const stride = 7 * 4;
    const bind = (name: string, size: number, off: number) => { const l = gl.getAttribLocation(p, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, off * 4); };
    bind("aPos", 2, 0); bind("aSize", 1, 2); bind("aCol", 4, 3);
    this.uRes = gl.getUniformLocation(p, "uRes");
    this.uDpr = gl.getUniformLocation(p, "uDpr");
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.gl = gl;
    return true;
  }

  private requestFrame() {
    if (this.raf || !this.visible || document.hidden) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private stop() { cancelAnimationFrame(this.raf); this.raf = 0; }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const quiet = this.scene.activity === "idle" && !this.scene.outlines.length && !this.scene.clusters.length;
    // 30 fps while only breathing, 60 while anything is happening.
    if (now - this.last < (quiet ? 30 : 14)) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    // Adaptive density: if frames stay slow, draw fewer dots.
    if (now - this.last > 24 && !quiet) { if (++this.slowFrames > 90 && this.n > 500) { this.n = Math.floor(this.n * 0.7); this.slowFrames = 0; } }
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    this.last = now;
    this.t += this.reduced ? 0 : dt;
    this.step(dt, now);
    this.draw();
  };

  /** Target position, size and colour for dot i in the current scene. */
  private target(i: number, now: number, mic: number, outLv: number, o: Float32Array) {
    const sc = this.scene, s = this.seed, i4 = i * 4;
    const t = this.t;
    // Allocation: outlines first, then task clusters, the rest form the presence.
    const outlineShare = sc.outlines.length ? Math.min(0.55, 0.22 * sc.outlines.length) : 0;
    const clusterShare = Math.min(0.3, sc.clusters.length * 0.06);
    const u = s[i4];
    const p = this.palette;
    let col = p.base, alpha = 0.85, size = 1.6 + s[i4 + 1] * 1.4;

    if (u < outlineShare) {
      const k = Math.floor((u / outlineShare) * sc.outlines.length);
      const ol = sc.outlines[Math.min(k, sc.outlines.length - 1)];
      const age = (now - ol.born) / OUTLINE_MS;
      const { x, y, w, h } = ol.rect;
      const per = 2 * (w + h);
      let d = ((s[i4 + 2] + age * 0.35) % 1) * per;
      let tx: number, ty: number;
      if (d < w) { tx = x + d; ty = y; } else if ((d -= w) < h) { tx = x + w; ty = y + d; } else if ((d -= h) < w) { tx = x + w - d; ty = y + h; } else { d -= w; tx = x; ty = y + h - d; }
      o[0] = tx; o[1] = ty; o[2] = 1.4 + s[i4 + 1]; o[3] = p.accent[0]; o[4] = p.accent[1]; o[5] = p.accent[2]; o[6] = 0.9 * Math.max(0, 1 - age * 0.6);
      return;
    }
    if (u < outlineShare + clusterShare && sc.clusters.length) {
      const k = Math.floor(((u - outlineShare) / clusterShare) * sc.clusters.length);
      const c = sc.clusters[Math.min(k, sc.clusters.length - 1)];
      const a = s[i4 + 2] * Math.PI * 2 + t * (c.status === "working" ? 1.6 : 0.5) * (s[i4 + 3] > 0.5 ? 1 : -1);
      const rr = 7 + s[i4 + 1] * 9;
      col = c.status === "failed" ? p.bad : c.status === "waiting" ? p.warn : c.status === "done" ? p.ok : p.accent;
      o[0] = c.cx + Math.cos(a) * rr; o[1] = c.cy + Math.sin(a) * rr * 0.8; o[2] = 1.3 + s[i4 + 1]; o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; o[6] = 0.95;
      return;
    }

    // The presence: a slowly turning sphere of dots that breathes and ripples.
    const { cx, cy, r } = sc.presence;
    const act = sc.activity;
    const spin = act === "processing" ? 1.1 : act === "listening" || act === "speaking" ? 0.35 : 0.16;
    const yaw = t * spin, pitch = 0.35 + Math.sin(t * 0.21) * 0.1;
    const sx = this.shell[i * 3], sy = this.shell[i * 3 + 1], sz = this.shell[i * 3 + 2];
    const x1 = sx * Math.cos(yaw) + sz * Math.sin(yaw), z1 = -sx * Math.sin(yaw) + sz * Math.cos(yaw);
    const y2 = sy * Math.cos(pitch) - z1 * Math.sin(pitch), z2 = sy * Math.sin(pitch) + z1 * Math.cos(pitch);
    const ang = Math.atan2(y2, x1);
    let rr = r * (1 + Math.sin(t * 1.3) * 0.025);
    if (act === "listening") rr *= 1.04 + mic * 0.22 * (0.6 + 0.4 * Math.sin(ang * 5 + t * 9));
    else if (act === "speaking") rr *= 1 + outLv * 0.16 * (0.7 + 0.3 * Math.sin(ang * 3 - t * 7));
    else if (act === "processing") rr *= 0.86 + 0.05 * Math.sin(ang * 6 + t * 5);
    else if (act === "waiting") rr *= 1 + 0.05 * Math.sin(t * 2.2);
    else if (act === "failed") rr *= 1.08;
    const depth = (z2 + 1) / 2;
    const sc2 = 1 + z2 * 0.18;
    let tx = cx + x1 * rr * sc2, ty = cy + y2 * rr * sc2;
    if (act === "failed") { ty += (1 - depth) * r * 0.25; }
    col = act === "waiting" ? p.warn : act === "failed" ? p.bad : act === "processing" || act === "listening" ? p.accent : p.base;
    if (this.flash > 0) col = [col[0] + (p.ok[0] - col[0]) * this.flash, col[1] + (p.ok[1] - col[1]) * this.flash, col[2] + (p.ok[2] - col[2]) * this.flash];
    alpha = (0.18 + 0.82 * depth) * (act === "failed" ? 0.45 : 1);
    size = 1.1 + 2.2 * depth;
    // Compact: only a fifth of the dots stay visible, so a small presence reads as dots, not a blob.
    if (r < 40) { size *= 0.7; if (s[i4 + 3] > 0.2) alpha = 0; }
    o[0] = tx; o[1] = ty; o[2] = size; o[3] = col[0]; o[4] = col[1]; o[5] = col[2]; o[6] = alpha;
  }

  private snap() {
    const o = new Float32Array(7);
    const now = performance.now();
    for (let i = 0; i < this.n; i++) { this.target(i, now, 0, 0, o); this.pos[i * 2] = o[0]; this.pos[i * 2 + 1] = o[1]; }
  }

  private step(dt: number, now: number) {
    const mic = this.levels.mic(), outLv = this.levels.out();
    this.flash = Math.max(0, this.flash - dt * 0.7);
    this.scene.outlines = this.scene.outlines.filter((ol) => now - ol.born < OUTLINE_MS * 1.6);
    const k = 70, c = 2 * Math.sqrt(k);
    const o = new Float32Array(7);
    for (let i = 0; i < this.n; i++) {
      this.target(i, now, mic, outLv, o);
      const j = i * 2;
      if (this.reduced) { this.pos[j] = o[0]; this.pos[j + 1] = o[1]; }
      else {
        // Critically damped spring toward the target, with a little stagger per dot.
        const kk = k * (0.75 + this.seed[i * 4 + 3] * 0.5);
        for (let a = 0; a < 2; a++) {
          const x = this.pos[j + a], v = this.vel[j + a];
          const acc = (o[a] - x) * kk - v * c;
          this.vel[j + a] = v + acc * dt;
          this.pos[j + a] = x + this.vel[j + a] * dt;
        }
      }
      this.out.set([this.pos[j], this.pos[j + 1], o[2], o[3], o[4], o[5], o[6]], i * 7);
    }
  }

  private draw() {
    if (this.gl) {
      const gl = this.gl;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(this.uRes, this.w, this.h);
      gl.uniform1f(this.uDpr, this.dpr);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, this.out.subarray(0, this.n * 7), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.POINTS, 0, this.n);
    } else if (this.ctx2d) {
      const g = this.ctx2d;
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.clearRect(0, 0, this.w, this.h);
      for (let i = 0; i < this.n; i += 2) {
        const b = i * 7;
        g.globalAlpha = this.out[b + 6];
        g.fillStyle = `rgb(${this.out[b + 3] * 255 | 0},${this.out[b + 4] * 255 | 0},${this.out[b + 5] * 255 | 0})`;
        const s = this.out[b + 2];
        g.fillRect(this.out[b] - s / 2, this.out[b + 1] - s / 2, s, s);
      }
      g.globalAlpha = 1;
    }
  }
}
