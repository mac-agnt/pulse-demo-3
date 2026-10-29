import { useEffect, useRef, useState } from "react";
import { hexToRgb, multiply, orbitView, perspective, project, type Mat4 } from "./glMath";

/* The ontology as a 3D neural map.

   The graph (nodes, synapses, clusters) and the live searches come from the
   logic; this only draws them. Everything static is uploaded to the GPU once:
   node twinkle and firing pulses along synapses animate in shaders from a
   single time uniform, so a frame costs a few draw calls. It draws straight
   onto the page's glass card in the app's ice blue, with no backdrop of its own.
   The CPU only rebuilds the small search overlay and places nine labels. */

type GNode = { x: number; y: number; z: number; r: number; cluster: number; kind: string };
type Graph = { nodes: GNode[]; edges: { a: number; b: number }[]; adj: unknown[][]; hubs: number[] };
type Search = {
  hue: string; delay: number; phase: string; fade: number; source: number; target: number;
  path: number[]; pathReveal: number; order: { v: number }[]; reveal: number;
  traces: { e: number; age: number }[]; sparks: { e: number; t: number }[];
};
export type NeuralScene = {
  graph: () => Graph;
  searches: () => Search[];
  clusters: { name: string; color: string }[];
};

type Props = { scene?: NeuralScene; counts: string[] };

/* Ice blue and white: the app's own light, so the map sits in the glass. */
const GOLD: [number, number, number] = [0.55, 0.78, 1];
const HOT: [number, number, number] = [0.94, 0.98, 1];
const FOV = (40 * Math.PI) / 180;
const KIND: Record<string, number> = { core: 0, leaf: 1, sub: 2, hub: 3 };
const ABOUT = [
  "customers & suppliers", "staff & contacts", "documents & contracts", "work & follow-ups",
  "billing & payments", "jobs on site", "depots & sites", "sign-offs & decisions",
];

/* The ontology's named relationships: [from, verb, to]. Each one is drawn as a
   lit arc between the two cluster hubs, with light flowing from → to. Names
   that aren't in the scene's clusters are skipped, so a re-labelled client
   graph just shows the relationships that still apply. */
const RELATIONS: [string, string, string][] = [
  ["Organisations", "employs", "People"],
  ["Organisations", "is billed on", "Invoices"],
  ["Organisations", "operates at", "Locations"],
  ["Files", "contracts", "Organisations"],
  ["People", "owns", "Tasks"],
  ["People", "signs off", "Approvals"],
  ["People", "attends", "Site visits"],
  ["Tasks", "raises", "Invoices"],
  ["Tasks", "books", "Site visits"],
  ["Invoices", "needs", "Approvals"],
  ["Site visits", "happen at", "Locations"],
  ["Site visits", "produce", "Files"],
];
type Rel = { a: number; b: number; verb: string };
function relationsFor(clusters: { name: string }[]): Rel[] {
  const at = (n: string) => clusters.findIndex((c) => c.name === n);
  return RELATIONS.map(([a, verb, b]) => ({ a: at(a), b: at(b), verb })).filter((r) => r.a >= 0 && r.b >= 0 && r.a !== r.b);
}

/* ── Shaders ───────────────────────────────────────────────────────── */

const NODE_VS = `
precision mediump float;
attribute vec3 aPos; attribute vec3 aCol; attribute float aSize; attribute float aKind; attribute float aCluster; attribute float aSeed;
uniform mat4 uMVP; uniform float uScale; uniform float uTime; uniform float uFocus; uniform float uDist; uniform float uR;
varying vec3 vCol; varying float vA; varying float vKind;
void main(){
  vec4 p = uMVP * vec4(aPos, 1.0);
  gl_Position = p;
  float depth = clamp((uDist + uR - p.w) / (2.0 * uR), 0.0, 1.0);
  float tw = aKind > 3.5 ? 1.0 : 0.7 + 0.3 * sin(uTime * (1.1 + aSeed * 2.2) + aSeed * 40.0);
  float on = (uFocus < -0.5 || aCluster < -0.5 || abs(aCluster - uFocus) < 0.5) ? 1.0 : 0.13;
  float beat = (aKind > 2.5 && aKind < 3.5) ? 1.0 + 0.1 * sin(uTime * 2.2 + aSeed * 6.0) : 1.0;
  gl_PointSize = clamp(aSize * uScale * beat / p.w, 1.5, 420.0);
  vA = (0.38 + 0.62 * depth) * tw * on;
  vCol = aCol; vKind = aKind;
}`;

const NODE_FS = `
precision mediump float;
varying vec3 vCol; varying float vA; varying float vKind;
void main(){
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = length(c);
  if (d > 1.0) discard;
  float a;
  float hot = smoothstep(0.3, 0.0, d);
  if (vKind > 2.5 && vKind < 3.5) {
    float ring = smoothstep(0.07, 0.0, abs(d - 0.74)) + 0.45 * smoothstep(0.05, 0.0, abs(d - 0.52));
    a = smoothstep(0.24, 0.0, d) + ring + exp(-d * d * 3.0) * 0.4;
  } else if (vKind > 3.5 && vKind < 4.5) {
    a = exp(-d * d * 4.0) * 0.5 + smoothstep(0.16, 0.0, d);
  } else {
    a = hot + exp(-d * d * 5.5) * 0.5;
  }
  gl_FragColor = vec4(mix(vCol, vec3(1.0), hot * 0.35), a * vA);
}`;

const LINE_VS = `
precision mediump float;
attribute vec3 aPos; attribute vec3 aCol; attribute float aAlpha; attribute float aCluster;
uniform mat4 uMVP; uniform float uFocus; uniform float uDist; uniform float uR;
varying vec3 vCol; varying float vA;
void main(){
  vec4 p = uMVP * vec4(aPos, 1.0);
  gl_Position = p;
  float depth = clamp((uDist + uR - p.w) / (2.0 * uR), 0.0, 1.0);
  float on = (uFocus < -0.5 || aCluster < -0.5 || abs(aCluster - uFocus) < 0.5) ? 1.0 : 0.1;
  vA = aAlpha * (0.35 + 0.65 * depth) * on;
  vCol = aCol;
}`;

const LINE_FS = `
precision mediump float;
varying vec3 vCol; varying float vA;
void main(){ gl_FragColor = vec4(vCol, vA); }`;

const PULSE_VS = `
precision mediump float;
attribute vec3 aA; attribute vec3 aB; attribute float aSpeed; attribute float aPhase; attribute vec3 aCol; attribute float aCluster;
uniform mat4 uMVP; uniform float uScale; uniform float uTime; uniform float uFocus; uniform float uDist; uniform float uR;
varying vec3 vCol; varying float vA; varying float vKind;
void main(){
  float t = fract(uTime * aSpeed + aPhase);
  vec4 p = uMVP * vec4(mix(aA, aB, t), 1.0);
  gl_Position = p;
  float life = sin(3.14159 * t);
  float depth = clamp((uDist + uR - p.w) / (2.0 * uR), 0.0, 1.0);
  float on = (uFocus < -0.5 || aCluster < -0.5 || abs(aCluster - uFocus) < 0.5) ? 1.0 : 0.08;
  gl_PointSize = clamp(0.05 * uScale * (0.5 + 0.8 * life) / p.w, 1.5, 40.0);
  vA = life * (0.3 + 0.7 * depth) * on;
  vCol = aCol; vKind = 1.0;
}`;

/* Relationship arcs. The strand is a screen-space ribbon (a few pixels wide,
   soft-edged, widening where the light passes); the beads are the comets that
   run from → to on each arc. A focused cluster's arcs brighten and the rest
   step back. Both share the same flow maths. */
const ARC_FLOW = `
  float head = fract(uTime * 0.14 + aArc * 0.371);
  float lag = fract(head - aT);
  float glow = uFlow * (exp(-lag * 9.0) + 0.5 * exp(-fract(lag + 0.5) * 12.0));
  float ends = smoothstep(0.0, 0.06, aT) * smoothstep(1.0, 0.94, aT);
  bool mine = abs(aClA - uFocus) < 0.5 || abs(aClB - uFocus) < 0.5;
  float on = uFocus < -0.5 ? 1.0 : mine ? 1.35 : 0.06;
  float depth = clamp((uDist + uR - p.w) / (2.0 * uR), 0.0, 1.0);`;

const RIBBON_VS = `
precision mediump float;
attribute vec3 aPos; attribute vec3 aOther; attribute float aSide; attribute vec3 aCol; attribute float aT; attribute float aArc; attribute float aClA; attribute float aClB;
uniform mat4 uMVP; uniform vec2 uView; uniform float uPx; uniform float uTime; uniform float uFocus; uniform float uDist; uniform float uR; uniform float uFlow;
varying vec3 vCol; varying float vA; varying float vSide;
void main(){
  vec4 p = uMVP * vec4(aPos, 1.0);
  vec4 q = uMVP * vec4(aOther, 1.0);
  vec2 sp = p.xy / p.w * uView, sq = q.xy / q.w * uView;
  vec2 d = sq - sp;
  d = length(d) > 0.0001 ? normalize(d) : vec2(1.0, 0.0);
  ${ARC_FLOW}
  float hw = uPx * (1.5 + 1.1 * depth + 3.4 * glow) * (mine && uFocus > -0.5 ? 1.35 : 1.0);
  p.xy += vec2(-d.y, d.x) * aSide * hw / uView * p.w;
  gl_Position = p;
  vA = min(1.0, ends * (0.62 + 0.5 * glow) * (0.4 + 0.6 * depth) * on);
  vCol = mix(aCol, vec3(1.0), glow * 0.3); vSide = aSide;
}`;

const RIBBON_FS = `
precision mediump float;
varying vec3 vCol; varying float vA; varying float vSide;
void main(){
  float core = exp(-vSide * vSide * 14.0);
  gl_FragColor = vec4(mix(vCol, vec3(1.0), core * 0.18), vA * (exp(-vSide * vSide * 2.4) * 0.8 + core * 0.25));
}`;

const BEAD_VS = `
precision mediump float;
attribute vec3 aPos; attribute vec3 aCol; attribute float aT; attribute float aArc; attribute float aClA; attribute float aClB;
uniform mat4 uMVP; uniform float uScale; uniform float uTime; uniform float uFocus; uniform float uDist; uniform float uR; uniform float uFlow;
varying vec3 vCol; varying float vA; varying float vKind;
void main(){
  vec4 p = uMVP * vec4(aPos, 1.0);
  gl_Position = p;
  ${ARC_FLOW}
  gl_PointSize = clamp((0.008 + 0.06 * glow) * uScale / p.w, 1.5, 64.0);
  vA = ends * (0.08 + 0.9 * glow) * (0.3 + 0.7 * depth) * on;
  vCol = mix(aCol, vec3(1.0), glow * 0.5); vKind = 1.0;
}`;

/* ── GL plumbing ───────────────────────────────────────────────────── */

type Prog = { p: WebGLProgram; a: Record<string, number>; u: Record<string, WebGLUniformLocation | null> };

function program(gl: WebGLRenderingContext, vs: string, fs: string, attrs: string[], unis: string[]): Prog {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type) as WebGLShader;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
    return s;
  };
  const p = gl.createProgram() as WebGLProgram;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
  const a: Record<string, number> = {}, u: Record<string, WebGLUniformLocation | null> = {};
  attrs.forEach((n) => { a[n] = gl.getAttribLocation(p, n); });
  unis.forEach((n) => { u[n] = gl.getUniformLocation(p, n); });
  return { p, a, u };
}

/** Bind interleaved float attributes: [name, size] in order. */
function layout(gl: WebGLRenderingContext, prog: Prog, spec: [string, number][]) {
  const stride = spec.reduce((s, [, n]) => s + n, 0) * 4;
  let off = 0;
  for (const [name, n] of spec) {
    const loc = prog.a[name];
    if (loc >= 0) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, stride, off);
    }
    off += n * 4;
  }
}

// Every program here uses at most eight attributes; switching programs only
// needs those slots cleared, not the driver's whole range.
function unbindAll(gl: WebGLRenderingContext) {
  for (let i = 0; i < 8; i++) gl.disableVertexAttribArray(i);
}

const NODE_SPEC: [string, number][] = [["aPos", 3], ["aCol", 3], ["aSize", 1], ["aKind", 1], ["aCluster", 1], ["aSeed", 1]];
const LINE_SPEC: [string, number][] = [["aPos", 3], ["aCol", 3], ["aAlpha", 1], ["aCluster", 1]];
const PULSE_SPEC: [string, number][] = [["aA", 3], ["aB", 3], ["aSpeed", 1], ["aPhase", 1], ["aCol", 3], ["aCluster", 1]];
const BEAD_SPEC: [string, number][] = [["aPos", 3], ["aCol", 3], ["aT", 1], ["aArc", 1], ["aClA", 1], ["aClB", 1]];
const RIBBON_SPEC: [string, number][] = [["aPos", 3], ["aOther", 3], ["aSide", 1], ["aCol", 3], ["aT", 1], ["aArc", 1], ["aClA", 1], ["aClB", 1]];
const ARC_UNIS = ["uMVP", "uScale", "uView", "uPx", "uTime", "uFocus", "uDist", "uR", "uFlow"];

/* ── Component ─────────────────────────────────────────────────────── */

export default function NeuralMap({ scene, counts }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  const coreLabel = useRef<HTMLDivElement>(null);
  const relLabels = useRef<(HTMLDivElement | null)[]>([]);
  const tip = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(-1);
  const [failed, setFailed] = useState(false);
  const focusRef = useRef(-1);
  focusRef.current = focus;

  useEffect(() => {
    const cv = canvas.current, box = wrap.current;
    if (!cv || !box || !scene) return;
    const gl = cv.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false, powerPreference: "high-performance" });
    if (!gl) { setFailed(true); return; }

    const g = scene.graph();
    const clusters = scene.clusters.map((c) => hexToRgb(c.color));
    const N = g.nodes.length;
    const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

    // Fit the globe to where the network actually is: a handful of far
    // satellites would otherwise push the camera back and shrink everything.
    const radii = g.nodes.map((n) => Math.hypot(n.x, n.y, n.z)).sort((a, b) => a - b);
    const R = radii[Math.floor(radii.length * 0.9)] * 1.06;

    const colorOf = (n: GNode): [number, number, number] => {
      if (n.kind === "core") { const k = rnd(); return k < 0.3 ? HOT : k < 0.75 ? GOLD : [0.36, 0.62, 1]; }
      const c = clusters[n.cluster] || GOLD;
      return [c[0] * 0.9 + 0.06, c[1] * 0.9 + 0.06, c[2] * 0.9 + 0.06];
    };
    const nodeCol = g.nodes.map(colorOf);

    // Nodes, a dust shell around the globe, and the core glow as one buffer.
    const DUST = 700;
    const nodeData = new Float32Array((N + DUST + 1) * 10);
    let o = 0;
    const put = (x: number, y: number, z: number, c: number[], size: number, kind: number, cluster: number, seed: number) => {
      nodeData.set([x, y, z, c[0], c[1], c[2], size, kind, cluster, seed], o); o += 10;
    };
    g.nodes.forEach((n, i) => {
      const kind = KIND[n.kind] ?? 1;
      const size = kind === 3 ? 0.26 : kind === 2 ? n.r * 0.032 : n.r * (kind === 0 ? 0.026 : 0.034);
      put(n.x, n.y, n.z, nodeCol[i], size, kind, kind === 0 ? -1 : n.cluster, rnd());
    });
    for (let i = 0; i < DUST; i++) {
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, rr = R * (1.02 + rnd() * 0.5), s = Math.sqrt(1 - u * u);
      put(Math.cos(th) * s * rr, u * rr, Math.sin(th) * s * rr, HOT, 0.005 + rnd() * 0.009, 1, -1, rnd());
    }
    put(0, 0, 0, [0.7, 0.86, 1], 1.0, 4, -1, 0);
    const nodeCount = N + DUST + 1;

    // Synapses.
    const E = g.edges.length;
    const lineData = new Float32Array(E * 2 * 8);
    o = 0;
    for (const e of g.edges) {
      const A = g.nodes[e.a], B = g.nodes[e.b];
      const coreA = A.kind === "core", coreB = B.kind === "core";
      const hub = A.kind === "hub" || B.kind === "hub";
      const cl = coreA && coreB ? -1 : coreA ? B.cluster : A.cluster;
      const alpha = coreA && coreB ? 0.16 : hub ? 0.6 : coreA || coreB ? 0.22 : 0.3;
      for (const [n, idx] of [[A, e.a], [B, e.b]] as [GNode, number][]) {
        const c = coreA && coreB ? GOLD : nodeCol[idx];
        lineData.set([n.x, n.y, n.z, c[0], c[1], c[2], alpha, cl], o); o += 8;
      }
    }

    // Firing pulses: a slice of synapses, each carrying one travelling spark.
    const P = Math.min(2200, E);
    const pulseData = new Float32Array(P * 12);
    o = 0;
    for (let i = 0; i < P; i++) {
      const e = g.edges[Math.floor(rnd() * E)];
      const flip = rnd() < 0.5;
      const A = g.nodes[flip ? e.a : e.b], B = g.nodes[flip ? e.b : e.a];
      const coreish = A.kind === "core" && B.kind === "core";
      const c = coreish || rnd() < 0.55 ? (rnd() < 0.3 ? HOT : GOLD) : nodeCol[flip ? e.b : e.a];
      pulseData.set([A.x, A.y, A.z, B.x, B.y, B.z, 0.25 + rnd() * 0.9, rnd(), c[0], c[1], c[2], coreish ? -1 : (A.kind === "core" ? B.cluster : A.cluster)], o); o += 12;
    }

    // Relationship arcs between cluster hubs. Each bows outward around the
    // globe (a quadratic curve with its control point pushed off the centre),
    // sampled densely enough that the beads read as one lit strand.
    const hubIdx = scene.clusters.map((_, ci) => g.hubs.find((h) => g.nodes[h].cluster === ci) ?? -1);
    const rels = relationsFor(scene.clusters).filter((r) => hubIdx[r.a] >= 0 && hubIdx[r.b] >= 0);
    const bez = (A: GNode, C: number[], B: GNode, t: number) => {
      const u = 1 - t;
      return [u * u * A.x + 2 * u * t * C[0] + t * t * B.x, u * u * A.y + 2 * u * t * C[1] + t * t * B.y, u * u * A.z + 2 * u * t * C[2] + t * t * B.z];
    };
    const arcMid: number[][] = [];
    const beads: number[] = [], ribbon: number[] = [];
    rels.forEach((r, ai) => {
      const A = g.nodes[hubIdx[r.a]], B = g.nodes[hubIdx[r.b]];
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, mz = (A.z + B.z) / 2;
      const ml = Math.hypot(mx, my, mz);
      const dir = ml > 0.12 ? [mx / ml, my / ml, mz / ml] : [0, 1, 0];
      const lift = ((Math.hypot(A.x, A.y, A.z) + Math.hypot(B.x, B.y, B.z)) / 2) * 1.42;
      const C = [dir[0] * lift, dir[1] * lift, dir[2] * lift];
      let len = 0, prev = bez(A, C, B, 0);
      for (let k = 1; k <= 32; k++) { const q = bez(A, C, B, k / 32); len += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]); prev = q; }
      const n = Math.max(24, Math.ceil(len / 0.02));
      const ca = clusters[r.a], cb = clusters[r.b];
      let last: { q: number[]; tail: number[] } | null = null;
      for (let k = 0; k <= n; k++) {
        const t = k / n, q = bez(A, C, B, t);
        const c = [0, 1, 2].map((j) => (ca[j] + (cb[j] - ca[j]) * t) * 0.92 + 0.04);
        const tail = [c[0], c[1], c[2], t, ai, r.a, r.b];
        beads.push(q[0], q[1], q[2], ...tail);
        if (last) {
          // One quad per segment, two triangles; each corner knows the other end.
          const P0 = last.q, P1 = q, T0 = last.tail, T1 = tail;
          const v = (at: number[], other: number[], side: number, tl: number[]) => ribbon.push(at[0], at[1], at[2], other[0], other[1], other[2], side, ...tl);
          v(P0, P1, -1, T0); v(P0, P1, 1, T0); v(P1, P0, 1, T1);
          v(P0, P1, -1, T0); v(P1, P0, 1, T1); v(P1, P0, -1, T1);
        }
        last = { q, tail };
      }
      arcMid.push(bez(A, C, B, 0.5));
    });
    const arcBeadData = new Float32Array(beads), arcRibbonData = new Float32Array(ribbon);

    let nodeP: Prog, lineP: Prog, pulseP: Prog, ribbonP: Prog, beadP: Prog;
    try {
      nodeP = program(gl, NODE_VS, NODE_FS, NODE_SPEC.map((s) => s[0]), ["uMVP", "uScale", "uTime", "uFocus", "uDist", "uR"]);
      lineP = program(gl, LINE_VS, LINE_FS, LINE_SPEC.map((s) => s[0]), ["uMVP", "uFocus", "uDist", "uR"]);
      pulseP = program(gl, PULSE_VS, NODE_FS, PULSE_SPEC.map((s) => s[0]), ["uMVP", "uScale", "uTime", "uFocus", "uDist", "uR"]);
      ribbonP = program(gl, RIBBON_VS, RIBBON_FS, RIBBON_SPEC.map((s) => s[0]), ARC_UNIS);
      beadP = program(gl, BEAD_VS, NODE_FS, BEAD_SPEC.map((s) => s[0]), ARC_UNIS);
    } catch {
      setFailed(true);
      return;
    }
    const buf = (data: Float32Array, usage: number = gl.STATIC_DRAW) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      return b;
    };
    const nodeBuf = buf(nodeData), lineBuf = buf(lineData), pulseBuf = buf(pulseData);
    const arcRibbonBuf = buf(arcRibbonData), arcBeadBuf = buf(arcBeadData);
    const fxLineBuf = gl.createBuffer(), fxPointBuf = gl.createBuffer();
    let fxLines = new Float32Array(8 * 4096), fxPoints = new Float32Array(10 * 1024);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clearColor(0, 0, 0, 0);

    // Camera.
    const cam = { yaw: 0.6, pitch: 0.22, dist: R / Math.sin(FOV / 2) * 1.02, vyaw: 0.06, vpitch: 0, targetYaw: null as number | null };
    const baseDist = cam.dist;
    let W = 0, H = 0, dpr = 1;
    const fit = () => {
      const r = box.getBoundingClientRect();
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
      gl.viewport(0, 0, cv.width, cv.height);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);

    let mvp: Mat4 = new Float32Array(16);
    let dragging = false, moved = 0, lastX = 0, lastY = 0, lastInput = 0, hover = -1;
    let pointer: { x: number; y: number } | null = null;

    const pick = (x: number, y: number) => {
      let best = -1, bestD = 1e9;
      for (let i = 0; i < N; i++) {
        const n = g.nodes[i];
        const p = project(mvp, n.x, n.y, n.z, W, H);
        if (!p.w) continue;
        const reach = n.kind === "hub" ? 26 : 9;
        const d = Math.hypot(p.sx - x, p.sy - y);
        if (d < reach && d - (n.kind === "hub" ? 12 : 0) < bestD) { bestD = d; best = i; }
      }
      return best;
    };

    const onDown = (e: PointerEvent) => {
      dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; lastInput = performance.now();
      cam.targetYaw = null;
      cv.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      cam.yaw += dx * 0.006; cam.pitch = Math.max(-1.25, Math.min(1.25, cam.pitch + dy * 0.006));
      cam.vyaw = dx * 0.35; cam.vpitch = dy * 0.35;
      lastX = e.clientX; lastY = e.clientY; lastInput = performance.now();
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
      if (moved < 5) {
        const r = cv.getBoundingClientRect();
        const hit = pick(e.clientX - r.left, e.clientY - r.top);
        if (hit >= 0 && g.nodes[hit].kind !== "core") {
          const n = g.nodes[hit];
          setFocus((f) => (f === n.cluster ? -1 : n.cluster));
          cam.targetYaw = Math.atan2(-n.x, n.z);
        } else setFocus(-1);
      }
    };
    const onLeave = () => { pointer = null; hover = -1; };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.dist = Math.max(baseDist * 0.45, Math.min(baseDist * 1.8, cam.dist * Math.exp(e.deltaY * 0.0012)));
      lastInput = performance.now();
    };
    const onDbl = () => { cam.dist = baseDist; cam.pitch = 0.22; setFocus(-1); };
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointerleave", onLeave);
    cv.addEventListener("wheel", onWheel, { passive: false });
    cv.addEventListener("dblclick", onDbl);

    /* Search overlay: lit traces, sparks and the settled path, rebuilt each frame. */
    const buildFx = () => {
      let lo = 0, po = 0;
      const line = (a: GNode, b: GNode, c: number[], al: number) => {
        if (lo + 16 > fxLines.length) { const n = new Float32Array(fxLines.length * 2); n.set(fxLines); fxLines = n; }
        fxLines.set([a.x, a.y, a.z, c[0], c[1], c[2], al, -1, b.x, b.y, b.z, c[0], c[1], c[2], al, -1], lo); lo += 16;
      };
      const point = (x: number, y: number, z: number, c: number[], size: number, kind: number) => {
        if (po + 10 > fxPoints.length) { const n = new Float32Array(fxPoints.length * 2); n.set(fxPoints); fxPoints = n; }
        fxPoints.set([x, y, z, c[0], c[1], c[2], size, kind, -1, 0], po); po += 10;
      };
      for (const s of scene.searches()) {
        if (s.delay > 0) continue;
        const c = hexToRgb(s.hue), k = 1 - (s.fade || 0);
        if (k <= 0.01) continue;
        for (const tr of s.traces) {
          const e = g.edges[tr.e];
          if (e) line(g.nodes[e.a], g.nodes[e.b], c, Math.max(0, 1 - tr.age / 1000) * 0.7 * k);
        }
        for (const sp of s.sparks) {
          const e = g.edges[sp.e];
          if (!e) continue;
          const a = g.nodes[e.a], b = g.nodes[e.b];
          point(a.x + (b.x - a.x) * sp.t, a.y + (b.y - a.y) * sp.t, a.z + (b.z - a.z) * sp.t, HOT, 0.05, 1);
        }
        if (s.phase === "sweep") {
          const head = Math.floor(s.reveal);
          for (let i = Math.max(0, head - 24); i < Math.min(s.order.length, head); i++) {
            const n = g.nodes[s.order[i].v];
            point(n.x, n.y, n.z, c, 0.06, 1);
          }
        } else {
          const upto = Math.min(s.path.length - 1, Math.floor(s.pathReveal));
          for (let i = 0; i < upto; i++) {
            const a = g.nodes[s.path[i]], b = g.nodes[s.path[i + 1]];
            line(a, b, HOT, k); line(a, b, c, k);
            point(a.x, a.y, a.z, c, 0.09, 1);
          }
        }
        const src = g.nodes[s.source], tgt = g.nodes[s.target];
        if (src) point(src.x, src.y, src.z, c, 0.26 * k, 3);
        if (tgt && s.phase !== "sweep") point(tgt.x, tgt.y, tgt.z, c, 0.3 * k, 3);
      }
      return { lo, po };
    };

    /* Labels ride their hubs; the one facing you is brightest. */
    const placeLabels = () => {
      hubIdx.forEach((h, ci) => {
        const el = labels.current[ci];
        if (!el || h < 0) return;
        const n = g.nodes[h];
        const p = project(mvp, n.x, n.y, n.z, W, H);
        const front = Math.max(0, Math.min(1, (cam.dist + R - p.w) / (2 * R)));
        const f = focusRef.current;
        const on = f < 0 || f === ci;
        el.style.transform = "translate(" + p.sx.toFixed(1) + "px," + (p.sy + 18).toFixed(1) + "px) translateX(-50%)";
        el.style.opacity = String(on ? 0.25 + 0.75 * front : 0.12);
        el.style.zIndex = String(Math.round(front * 100));
      });
      // Verbs sit on their arcs: the front half shows, the far side fades out,
      // and a focused cluster shows all of its own relationships.
      rels.forEach((r, ri) => {
        const el = relLabels.current[ri];
        const m = arcMid[ri];
        if (!el || !m) return;
        const p = project(mvp, m[0], m[1], m[2], W, H);
        const front = Math.max(0, Math.min(1, (cam.dist + R - p.w) / (2 * R)));
        const f = focusRef.current;
        const op = f < 0 ? Math.max(0, (front - 0.3) / 0.7) * 0.9 : r.a === f || r.b === f ? 0.55 + 0.45 * front : 0;
        el.style.transform = "translate(" + p.sx.toFixed(1) + "px," + p.sy.toFixed(1) + "px) translate(-50%,-50%)";
        el.style.opacity = op.toFixed(2);
        el.style.zIndex = String(Math.round(front * 100));
      });
      const c = project(mvp, 0, 0, 0, W, H);
      if (coreLabel.current) coreLabel.current.style.transform = "translate(" + c.sx.toFixed(1) + "px," + (c.sy + 30).toFixed(1) + "px) translateX(-50%)";
    };

    const showTip = () => {
      const el = tip.current;
      if (!el) return;
      if (hover < 0 || !pointer || dragging) { el.style.opacity = "0"; return; }
      const n = g.nodes[hover];
      const name = scene.clusters[n.cluster]?.name ?? "Record";
      const role = n.kind === "hub" ? "Cluster hub" : n.kind === "sub" ? "Record group" : n.kind === "core" ? "Core record" : "Record";
      el.textContent = (n.kind === "core" ? "Knowledge core" : name) + " · " + role + " · " + (g.adj[hover]?.length ?? 0) + " links";
      el.style.transform = "translate(" + (pointer.x + 14) + "px," + (pointer.y + 14) + "px)";
      el.style.opacity = "1";
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let raf = 0, last = t0, lastPick = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const searches = scene.searches();
      const active = dragging || now - lastInput < 1500 || cam.targetYaw !== null || searches.some((s) => s.delay <= 0 && (s.fade || 0) < 1);
      if (now - last < (active ? 15 : 32)) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = reduced ? 0 : (now - t0) / 1000;

      // Orbit: drift, inertia after a drag, or ease to a focused hub.
      if (!dragging) {
        if (cam.targetYaw !== null) {
          let d = cam.targetYaw - cam.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          cam.yaw += d * Math.min(1, dt * 3);
          if (Math.abs(d) < 0.002) cam.targetYaw = null;
        } else {
          cam.vyaw += ((reduced ? 0 : 0.06) - cam.vyaw) * Math.min(1, dt * 1.5);
          cam.yaw += cam.vyaw * dt;
        }
        cam.vpitch *= Math.exp(-dt * 4);
        cam.pitch = Math.max(-1.25, Math.min(1.25, cam.pitch + cam.vpitch * dt));
      }

      const aspect = W / Math.max(1, H);
      mvp = multiply(perspective(FOV, aspect, 0.1, 60), orbitView(cam.yaw, cam.pitch, cam.dist));
      const scale = (cv.height) / (2 * Math.tan(FOV / 2));
      const f = focusRef.current;

      gl.clear(gl.COLOR_BUFFER_BIT);

      // Synapses.
      gl.useProgram(lineP.p);
      gl.uniformMatrix4fv(lineP.u.uMVP, false, mvp);
      gl.uniform1f(lineP.u.uFocus, f);
      gl.uniform1f(lineP.u.uDist, cam.dist);
      gl.uniform1f(lineP.u.uR, R);
      gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
      unbindAll(gl); layout(gl, lineP, LINE_SPEC);
      gl.drawArrays(gl.LINES, 0, E * 2);

      // Firing.
      gl.useProgram(pulseP.p);
      gl.uniformMatrix4fv(pulseP.u.uMVP, false, mvp);
      gl.uniform1f(pulseP.u.uScale, scale);
      gl.uniform1f(pulseP.u.uTime, t);
      gl.uniform1f(pulseP.u.uFocus, f);
      gl.uniform1f(pulseP.u.uDist, cam.dist);
      gl.uniform1f(pulseP.u.uR, R);
      gl.bindBuffer(gl.ARRAY_BUFFER, pulseBuf);
      unbindAll(gl); layout(gl, pulseP, PULSE_SPEC);
      gl.drawArrays(gl.POINTS, 0, P);

      // Neurons.
      gl.useProgram(nodeP.p);
      gl.uniformMatrix4fv(nodeP.u.uMVP, false, mvp);
      gl.uniform1f(nodeP.u.uScale, scale);
      gl.uniform1f(nodeP.u.uTime, t);
      gl.uniform1f(nodeP.u.uFocus, f);
      gl.uniform1f(nodeP.u.uDist, cam.dist);
      gl.uniform1f(nodeP.u.uR, R);
      gl.bindBuffer(gl.ARRAY_BUFFER, nodeBuf);
      unbindAll(gl); layout(gl, nodeP, NODE_SPEC);
      gl.drawArrays(gl.POINTS, 0, nodeCount);

      // Relationship arcs: the ribbon, then the comets over it. The canvas
      // isn't premultiplied, so alpha accumulates linearly here; with the
      // default blend a soft strand would barely register against the page.
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
      const arcPasses: [Prog, WebGLBuffer | null, [string, number][], number, number][] = [
        [ribbonP, arcRibbonBuf, RIBBON_SPEC, gl.TRIANGLES, arcRibbonData.length / 14],
        [beadP, arcBeadBuf, BEAD_SPEC, gl.POINTS, arcBeadData.length / 10],
      ];
      for (const [pr, b, spec, mode, count] of arcPasses) {
        if (!count) continue;
        gl.useProgram(pr.p);
        gl.uniformMatrix4fv(pr.u.uMVP, false, mvp);
        gl.uniform1f(pr.u.uScale, scale);
        gl.uniform1f(pr.u.uTime, t);
        gl.uniform1f(pr.u.uFocus, f);
        gl.uniform1f(pr.u.uDist, cam.dist);
        gl.uniform1f(pr.u.uR, R);
        gl.uniform1f(pr.u.uFlow, reduced ? 0 : 1);
        gl.uniform2f(pr.u.uView, cv.width / 2, cv.height / 2);
        gl.uniform1f(pr.u.uPx, dpr);
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        unbindAll(gl); layout(gl, pr, spec);
        gl.drawArrays(mode, 0, count);
      }
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

      // Live searches on top.
      const { lo, po } = buildFx();
      if (lo) {
        gl.useProgram(lineP.p);
        gl.uniform1f(lineP.u.uFocus, -1);
        gl.bindBuffer(gl.ARRAY_BUFFER, fxLineBuf);
        gl.bufferData(gl.ARRAY_BUFFER, fxLines.subarray(0, lo), gl.DYNAMIC_DRAW);
        unbindAll(gl); layout(gl, lineP, LINE_SPEC);
        gl.drawArrays(gl.LINES, 0, lo / 8);
      }
      if (po) {
        gl.useProgram(nodeP.p);
        gl.uniform1f(nodeP.u.uFocus, -1);
        gl.bindBuffer(gl.ARRAY_BUFFER, fxPointBuf);
        gl.bufferData(gl.ARRAY_BUFFER, fxPoints.subarray(0, po), gl.DYNAMIC_DRAW);
        unbindAll(gl); layout(gl, nodeP, NODE_SPEC);
        gl.drawArrays(gl.POINTS, 0, po / 10);
      }

      placeLabels();
      if (pointer && !dragging && now - lastPick > 60) { hover = pick(pointer.x, pointer.y); lastPick = now; cv.style.cursor = hover >= 0 ? "pointer" : "grab"; }
      showTip();
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
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointerleave", onLeave);
      cv.removeEventListener("wheel", onWheel);
      cv.removeEventListener("dblclick", onDbl);
      [nodeBuf, lineBuf, pulseBuf, arcRibbonBuf, arcBeadBuf, fxLineBuf, fxPointBuf].forEach((b) => gl.deleteBuffer(b));
      [nodeP, lineP, pulseP, ribbonP, beadP].forEach((pr) => gl.deleteProgram(pr.p));
    };
  }, [scene]);

  const clusters = scene?.clusters ?? [];
  const rels = relationsFor(clusters);
  const focusRels = focus >= 0 ? rels.filter((r) => r.a === focus || r.b === focus).length : 0;
  return (
    <div ref={wrap} className="nm">
      <canvas ref={canvas} className="nm-canvas" data-onto-graph="1" data-onto-3d="1" aria-label="3D map of every record and how they connect" role="img" />
      {failed && <div className="nm-fail">This browser can't draw the 3D map (WebGL is off).</div>}
      <div className="nm-core" ref={coreLabel} aria-hidden="true">
        <b>Knowledge core</b>
        <span>the company record</span>
      </div>
      {clusters.map((c, i) => (
        <div key={c.name} className="nm-label" ref={(el) => { labels.current[i] = el; }} data-focus={focus === i ? "1" : "0"}>
          <span className="nm-label-dot" style={{ background: c.color, boxShadow: "0 0 10px " + c.color }} />
          <b>{c.name}</b>
          <span className="nm-label-count">{counts[i] ?? ""}</span>
          <span className="nm-label-about">{ABOUT[i] ?? ""}</span>
        </div>
      ))}
      {rels.map((r, i) => (
        <div key={r.a + "-" + r.b} className="nm-rel" ref={(el) => { relLabels.current[i] = el; }} aria-hidden="true">
          {r.verb}
          {focus >= 0 && <span>{clusters[r.a].name + " → " + clusters[r.b].name}</span>}
        </div>
      ))}
      <div className="nm-tip" ref={tip} aria-hidden="true" />
      <div className="nm-hud nm-hud-tl">
        <b>Neural map</b>
        <span>{focus >= 0 ? clusters[focus]?.name + " in focus · " + focusRels + (focusRels === 1 ? " relationship" : " relationships") : "All clusters · " + rels.length + " relationships"}</span>
      </div>
      <div className="nm-hud nm-hud-bl">Drag to orbit · scroll to zoom · click a cluster to focus · double-click to reset</div>
    </div>
  );
}
