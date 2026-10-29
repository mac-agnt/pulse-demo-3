import { useEffect, useRef, useState, type CSSProperties } from "react";

/* LiveOrb: an evenly lit sphere with two capsule eyes that follow the pointer.
   Adapted for many small orbs on one screen: every orb is drawn by ONE shared
   WebGL context (browsers cap live contexts at ~16) and copied into the orb's
   own 2D canvas. Orbs off screen are skipped, and an orb whose frame has not
   changed is not redrawn. */

export type LiveOrbVariant = "white" | "black" | "webgl" | "custom";
/** Eye expression: open, half-lidded, happy squint, wide open, or glancing up in thought. */
export type LiveOrbMood = "open" | "half" | "happy" | "wide" | "thinking";

export type LiveOrbOptions = {
  /** Material preset. Default `"white"`. */
  variant?: LiveOrbVariant;
  /** Body hex, used when `variant="custom"`. */
  color?: string;
  /** Eye hex, used when `variant="custom"`. */
  eyeColor?: string;
  /** Unlit wash stops, used when `variant="webgl"`. */
  colors?: string[];
  /** Eyes follow the pointer. Default `true`. */
  interactive?: boolean;
  /** Occasional blink. Default `true`. */
  blink?: boolean;
  mood?: LiveOrbMood;
  /** Silhouette scale, x and y, each at most 1. Default `[1, 1]`. */
  squash?: [number, number];
  /** Horizontal eye spacing on the sphere. Default `0.32`. */
  eyeGap?: number;
};

export const WHITE = { color: "#F4F4F5", eyeColor: "#09090B" } as const;
export const BLACK = { color: "#18181B", eyeColor: "#F4F4F5" } as const;
export const CUSTOM_DEFAULT = { color: "#7C5CFF", eyeColor: "#FAFAFA" } as const;
/** Violet / foam / dust-rose: stock unlit wash. */
export const WEBGL_COLORS = ["#7C6AF7", "#7DD3C7", "#E8B4D4"];

const VERT = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_look;
uniform float u_blink;
uniform float u_mode;
uniform vec3 u_body;
uniform vec3 u_eye;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec2 u_squash;
uniform float u_gap;
uniform float u_wide;
uniform float u_happy;
uniform float u_aa;
// Eye weight: 1 at hero sizes, up to ~1.9 on small icons so eyes never thin to hairlines.
uniform float u_k;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

vec3 orient(vec3 p, vec2 look) {
  float yaw = look.x * 0.92;
  float pitch = -look.y * 0.78;
  float cy = cos(yaw);
  float sy = sin(yaw);
  float cp = cos(pitch);
  float sp = sin(pitch);
  vec3 q = vec3(p.x, p.y * cp - p.z * sp, p.y * sp + p.z * cp);
  return vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
}

float eyeMask(vec3 n, vec3 e, vec3 right, vec3 up, float halfH, float rad) {
  float facing = dot(n, e);
  float x = dot(n, right) - dot(e, right);
  float y = dot(n, up) - dot(e, up);
  y -= clamp(y, -halfH, halfH);
  float d = length(vec2(x, y)) - rad;
  float fill = 1.0 - smoothstep(-u_aa, u_aa, d);
  return fill * smoothstep(0.12, 0.32, facing);
}

// Happy squint: the upper half of a ring, drawn where the eye would be.
float happyMask(vec3 n, vec3 e, vec3 right, vec3 up) {
  float facing = dot(n, e);
  float x = dot(n, right) - dot(e, right);
  float y = dot(n, up) - dot(e, up) + 0.035;
  float d = abs(length(vec2(x, y)) - 0.082 * (1.0 + (u_k - 1.0) * 0.3)) - 0.024 * u_k;
  float fill = 1.0 - smoothstep(-u_aa, u_aa, d);
  fill *= smoothstep(-0.03, 0.0, y);
  return fill * smoothstep(0.12, 0.32, facing);
}

vec3 wash(vec3 n, float t) {
  vec2 q = n.xy * 2.2 + n.z * 0.85;
  vec2 w1 = vec2(
    fbm(q * 1.4 + vec2(t * 0.22, t * 0.18)),
    fbm(q * 1.4 + vec2(-t * 0.16, t * 0.24) + 4.1)
  );
  q += (w1 - 0.5) * 0.72;
  float f = fbm(q * 2.1 + vec2(0.0, t * 0.12));
  float g = fbm(q * 4.6 - vec2(t * 0.2, 0.0));
  vec3 col = mix(u_c1, u_c2, smoothstep(0.28, 0.72, f));
  return mix(col, u_c3, pow(smoothstep(0.42, 0.9, g), 1.4));
}

void main() {
  vec2 uv = (gl_FragCoord.xy / u_resolution.xy) * 2.0 - 1.0;
  uv.x *= u_resolution.x / max(u_resolution.y, 1.0);

  vec2 p = uv / (0.94 * u_squash);
  float r2 = dot(p, p);
  float edge = 1.0 - smoothstep(1.0 - u_aa, 1.0 + u_aa, sqrt(max(r2, 0.0)));
  if (edge <= 0.001) { gl_FragColor = vec4(0.0); return; }

  vec3 n = normalize(vec3(p, sqrt(max(1.0 - r2, 0.0))));

  vec2 look = u_look;
  float lm = length(look);
  if (lm > 1.0) look /= lm;

  vec3 right = orient(vec3(1.0, 0.0, 0.0), look);
  vec3 up = orient(vec3(0.0, 1.0, 0.0), look);
  vec3 eL = orient(normalize(vec3(-u_gap, 0.08, 1.0)), look);
  vec3 eR = orient(normalize(vec3(u_gap, 0.08, 1.0)), look);

  float halfH = mix(0.128 * u_wide * (1.0 + (u_k - 1.0) * 0.3), 0.012, u_blink);
  float rad = mix(0.054 * u_wide * u_k, 0.062 * u_k, u_blink);
  float open = max(eyeMask(n, eL, right, up, halfH, rad), eyeMask(n, eR, right, up, halfH, rad));
  float happy = max(happyMask(n, eL, right, up), happyMask(n, eR, right, up));
  float eyes = mix(open, happy, u_happy);

  vec3 body = u_mode > 0.5 ? wash(n, u_time) : u_body;
  vec3 col = mix(body, u_eye, clamp(eyes, 0.0, 1.0));
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), edge);
}
`;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return [0.96, 0.96, 0.96];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function resolveVariant(variant: LiveOrbVariant, color?: string, eyeColor?: string, colors?: string[]) {
  let body: string = WHITE.color;
  let eye: string = WHITE.eyeColor;
  let mode = 0;
  let palette: string[] = WEBGL_COLORS;
  if (variant === "black") {
    body = BLACK.color;
    eye = BLACK.eyeColor;
  } else if (variant === "webgl") {
    palette = colors && colors.length > 0 ? colors : WEBGL_COLORS;
    body = palette[1] ?? WEBGL_COLORS[1];
    eye = "#0C0C10";
    mode = 1;
  } else if (variant === "custom") {
    body = color ?? CUSTOM_DEFAULT.color;
    eye = eyeColor ?? CUSTOM_DEFAULT.eyeColor;
  }
  return { body, eye, mode, palette };
}

export function fallbackFaceStyle(resolved: ReturnType<typeof resolveVariant>): CSSProperties {
  if (resolved.mode === 1) {
    const [a, b, c] = [0, 1, 2].map((i) => resolved.palette[i] ?? WEBGL_COLORS[i]);
    return { backgroundImage: `linear-gradient(135deg, ${a}, ${b}, ${c})` };
  }
  return { backgroundColor: resolved.body };
}

/* ── The shared renderer ────────────────────────────────────────────────── */

type Opts = Required<Pick<LiveOrbOptions, "variant" | "interactive" | "blink" | "mood" | "squash" | "eyeGap">> & LiveOrbOptions;

type Entry = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  opts: Opts;
  look: { x: number; y: number };
  phase: number;
  nextBlink: number;
  blinkAt: number;
  visible: boolean;
  lastKey: string;
};

type Engine = {
  gl: WebGLRenderingContext;
  canvas: HTMLCanvasElement;
  u: Record<string, WebGLUniformLocation | null>;
};

const MAX_PX = 512;
const entries = new Set<Entry>();
const pointer = { x: 0, y: 0, at: -1e9 };
let engine: Engine | null = null;
let engineFailed = false;
let raf = 0;
let reduce = false;
let io: IntersectionObserver | null = null;
const byCanvas = new WeakMap<Element, Entry>();

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("LiveOrb: shader failed to compile\n", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function getEngine(): Engine | null {
  if (engine || engineFailed) return engine;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const gl = canvas.getContext("webgl", {
    alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: false
  });
  const vs = gl && compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = gl && compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const program = gl && vs && fs ? gl.createProgram() : null;
  if (!gl || !vs || !fs || !program) { engineFailed = true; return null; }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("LiveOrb: program failed to link\n", gl.getProgramInfoLog(program));
    engineFailed = true;
    return null;
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  // The fragment writes straight alpha; the canvas is non-premultiplied, so no blending.
  gl.disable(gl.BLEND);
  gl.enable(gl.SCISSOR_TEST);

  const u: Engine["u"] = {};
  for (const name of ["resolution", "time", "look", "blink", "mode", "body", "eye", "c1", "c2", "c3", "squash", "gap", "wide", "happy", "aa", "k"]) {
    u[name] = gl.getUniformLocation(program, "u_" + name);
  }

  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  reduce = mq.matches;
  mq.addEventListener("change", () => { reduce = mq.matches; });
  window.addEventListener("pointermove", (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.at = performance.now();
  }, { passive: true });
  io = new IntersectionObserver((list) => {
    for (const it of list) {
      const entry = byCanvas.get(it.target);
      if (entry) entry.visible = it.isIntersecting;
    }
  });

  engine = { gl, canvas, u };
  return engine;
}

const clamp1 = (v: number) => Math.min(1, Math.max(-1, v));

function tick(now: number) {
  raf = 0;
  const eng = engine;
  if (!eng || entries.size === 0) return;
  const { gl, u } = eng;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pointerLive = now - pointer.at < 4000;
  const time = now / 1000;

  for (const e of entries) {
    if (!e.visible) continue;
    const r = e.canvas.getBoundingClientRect();
    const w = Math.min(MAX_PX, Math.round(r.width * dpr));
    const h = Math.min(MAX_PX, Math.round(r.height * dpr));
    if (w < 4 || h < 4) continue;
    const o = e.opts;

    // Gaze: the pointer while it is moving, otherwise a slow idle drift.
    let tx = 0, ty = 0.08;
    if (o.interactive && pointerLive) {
      const reach = Math.max(180, r.width * 2);
      tx = clamp1((pointer.x - (r.left + r.width / 2)) / reach);
      ty = clamp1((r.top + r.height / 2 - pointer.y) / reach);
    } else if (!reduce && o.mood === "thinking") {
      tx = 0.42 + 0.18 * Math.sin(time * 0.6 + e.phase);
      ty = 0.55;
    } else if (!reduce) {
      tx = 0.34 * Math.sin(time * 0.37 + e.phase);
      ty = 0.08 + 0.18 * Math.sin(time * 0.23 + e.phase * 1.7);
    }
    e.look.x += (tx - e.look.x) * 0.16;
    e.look.y += (ty - e.look.y) * 0.16;

    let b = 0;
    if (!reduce && o.blink && o.mood !== "happy") {
      if (now >= e.nextBlink) {
        e.blinkAt = now;
        e.nextBlink = now + (o.mood === "wide" ? 1400 : 2200) + Math.random() * 3800;
      }
      const bt = (now - e.blinkAt) / 1000;
      if (bt < 0.055) b = bt / 0.055;
      else if (bt < 0.1) b = 1;
      else if (bt < 0.18) b = 1 - (bt - 0.1) / 0.08;
    }
    if (o.mood === "half") b = Math.max(b, 0.55);

    const resolved = resolveVariant(o.variant, o.color, o.eyeColor, o.colors);
    const key = [w, h, e.look.x.toFixed(3), e.look.y.toFixed(3), b.toFixed(2), resolved.body, resolved.eye,
      resolved.mode, resolved.palette.join(), o.mood, o.squash.join(), o.eyeGap].join("|");
    if (resolved.mode === 0 && key === e.lastKey) continue;
    e.lastKey = key;

    if (eng.canvas.width < w || eng.canvas.height < h) {
      eng.canvas.width = Math.max(eng.canvas.width, w);
      eng.canvas.height = Math.max(eng.canvas.height, h);
    }
    if (e.canvas.width !== w || e.canvas.height !== h) {
      e.canvas.width = w;
      e.canvas.height = h;
    }

    const body = hexToRgb(resolved.body);
    const eye = hexToRgb(resolved.eye);
    const pal = [0, 1, 2].map((i) => hexToRgb(resolved.palette[i % resolved.palette.length] ?? WEBGL_COLORS[i]));

    gl.viewport(0, 0, w, h);
    gl.scissor(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(u.resolution, w, h);
    gl.uniform1f(u.time, reduce ? 0 : time * 0.55);
    gl.uniform2f(u.look, e.look.x, e.look.y);
    gl.uniform1f(u.blink, b);
    gl.uniform1f(u.mode, resolved.mode);
    gl.uniform3f(u.body, body[0], body[1], body[2]);
    gl.uniform3f(u.eye, eye[0], eye[1], eye[2]);
    gl.uniform3f(u.c1, pal[0][0], pal[0][1], pal[0][2]);
    gl.uniform3f(u.c2, pal[1][0], pal[1][1], pal[1][2]);
    gl.uniform3f(u.c3, pal[2][0], pal[2][1], pal[2][2]);
    gl.uniform2f(u.squash, o.squash[0], o.squash[1]);
    gl.uniform1f(u.gap, o.eyeGap);
    gl.uniform1f(u.wide, o.mood === "wide" ? 1.25 : 1);
    gl.uniform1f(u.happy, o.mood === "happy" ? 1 : 0);
    // About one device pixel of edge softening, in sphere units.
    gl.uniform1f(u.aa, 1.2 / (0.94 * h * 0.5 * Math.min(o.squash[0], o.squash[1])));
    gl.uniform1f(u.k, Math.min(1.9, Math.max(1, 80 / Math.max(1, r.height))));
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // The drawing buffer is still intact within this task, so it can be copied out.
    e.ctx.clearRect(0, 0, w, h);
    e.ctx.drawImage(eng.canvas, 0, eng.canvas.height - h, w, h, 0, 0, w, h);
  }
  raf = requestAnimationFrame(tick);
}

function register(canvas: HTMLCanvasElement, opts: Opts): Entry | null {
  const eng = getEngine();
  const ctx = canvas.getContext("2d");
  if (!eng || !ctx || !io) return null;
  const now = performance.now();
  const entry: Entry = {
    canvas, ctx, opts, look: { x: 0, y: 0.08 }, phase: Math.random() * Math.PI * 2,
    nextBlink: now + 1200 + Math.random() * 3600, blinkAt: -1e4, visible: true, lastKey: ""
  };
  entries.add(entry);
  byCanvas.set(canvas, entry);
  io.observe(canvas);
  if (!raf) raf = requestAnimationFrame(tick);
  return entry;
}

function unregister(entry: Entry) {
  entries.delete(entry);
  io?.unobserve(entry.canvas);
  byCanvas.delete(entry.canvas);
}

/* ── The component ──────────────────────────────────────────────────────── */

export type LiveOrbProps = LiveOrbOptions & {
  className?: string;
  style?: CSSProperties;
  /** Edge length in CSS pixels. Default `280`. */
  size?: number;
  label?: string;
};

export function LiveOrb({
  className, style, size = 280, label = "Orb character",
  variant = "white", color, eyeColor, colors,
  interactive = true, blink = true, mood = "open", squash = [1, 1], eyeGap = 0.32
}: LiveOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const entryRef = useRef<Entry | null>(null);
  const [hasGl, setHasGl] = useState(true);
  const opts: Opts = { variant, color, eyeColor, colors, interactive, blink, mood, squash, eyeGap };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const entry = register(canvas, opts);
    entryRef.current = entry;
    setHasGl(!!entry);
    return () => {
      if (entry) unregister(entry);
      entryRef.current = null;
    };
    // Mount once; later option changes flow in through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (entryRef.current) entryRef.current.opts = opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, color, eyeColor, colors, interactive, blink, mood, squash[0], squash[1], eyeGap]);

  const resolved = resolveVariant(variant, color, eyeColor, colors);
  const [sx, sy] = squash;

  return (
    <div data-slot="live-orb" role="img" aria-label={label} className={className}
      style={{ position: "relative", flexShrink: 0, width: size, height: size, ...style }}>
      {!hasGl && (
        <div aria-hidden="true" style={{
          position: "absolute", left: `${50 - 47 * sx}%`, top: `${50 - 47 * sy}%`,
          width: `${94 * sx}%`, height: `${94 * sy}%`, borderRadius: "50%", overflow: "hidden", ...fallbackFaceStyle(resolved)
        }}>
          {[31, 56].map((left) => (
            <span key={left} style={{
              position: "absolute", borderRadius: 999, backgroundColor: resolved.eye,
              width: "13%", height: mood === "half" ? "14%" : "28%", left: `${left}%`, top: mood === "half" ? "44%" : "34%"
            }} />
          ))}
        </div>
      )}
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: hasGl ? "block" : "none" }} />
    </div>
  );
}

export default LiveOrb;
