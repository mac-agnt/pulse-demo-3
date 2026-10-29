/* Minimal column-major 4×4 matrix helpers for the neural map. */

export type Mat4 = Float32Array;

export function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) * nf; m[11] = -1; m[14] = 2 * far * near * nf;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

/** View for an orbit camera: back off `dist`, tilt by pitch, turn by yaw. */
export function orbitView(yaw: number, pitch: number, dist: number): Mat4 {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // T(0,0,-dist) · Rx(pitch) · Ry(yaw)
  const m = new Float32Array(16);
  m[0] = cy; m[1] = sp * sy; m[2] = -cp * sy; m[3] = 0;
  m[4] = 0; m[5] = cp; m[6] = sp; m[7] = 0;
  m[8] = sy; m[9] = -sp * cy; m[10] = cp * cy; m[11] = 0;
  m[12] = 0; m[13] = 0; m[14] = -dist; m[15] = 1;
  return m;
}

/** Project a point: returns screen x/y in CSS px and clip w (0 when behind). */
export function project(m: Mat4, x: number, y: number, z: number, w: number, h: number) {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (cw <= 0.0001) return { sx: -9999, sy: -9999, w: 0 };
  return { sx: (cx / cw * 0.5 + 0.5) * w, sy: (1 - (cy / cw * 0.5 + 0.5)) * h, w: cw };
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}
