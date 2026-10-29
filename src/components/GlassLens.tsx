import { useId, useLayoutEffect, useRef, useState } from "react";

/* The refracting layer of a liquid-glass surface.

   Sits behind a glass element's content and does the "glass" part: it blurs
   and saturates whatever is behind the element, and near the edges it bends
   the backdrop inward the way a thick lens does. The bend comes from an SVG
   displacement map sized to the element, so it only works where
   backdrop-filter accepts url() filters (Chromium). Everywhere else the lens
   falls back to plain frosted glass.

   This is a web approximation of Apple's Liquid Glass material, not Apple's
   own implementation (which exists only on Apple platforms). */

const SVG_BACKDROP =
  typeof navigator !== "undefined" && /(Chrome|Chromium|Edg)\//.test(navigator.userAgent);

const maps = new Map<string, string>();

/* Encodes, per pixel, how far to pull the backdrop: zero across the flat
   middle, rising along a convex curve inside the bezel band at the edge. */
function displacementMap(w: number, h: number, radius: number, bezel: number): string {
  const key = w + "x" + h + "r" + radius + "b" + bezel;
  const hit = maps.get(key);
  if (hit) return hit;
  const scale = 0.5;
  const cw = Math.max(2, Math.round(w * scale));
  const ch = Math.max(2, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(cw, ch);
  const hx = w / 2, hy = h / 2, r = Math.min(radius, hx, hy);
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      const x = (i + 0.5) / scale - hx;
      const y = (j + 0.5) / scale - hy;
      const qx = Math.abs(x) - (hx - r);
      const qy = Math.abs(y) - (hy - r);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const outside = Math.hypot(ox, oy);
      const inside = Math.min(Math.max(qx, qy), 0);
      const depth = -(outside + inside - r); // distance in from the edge
      let dx = 0, dy = 0;
      if (depth < bezel) {
        const t = 1 - Math.max(depth, 0) / bezel;
        const mag = 1 - Math.sqrt(1 - t * t);
        let nx: number, ny: number;
        if (qx > 0 && qy > 0) {
          const len = outside || 1;
          nx = (ox / len) * Math.sign(x);
          ny = (oy / len) * Math.sign(y);
        } else if (qx > qy) {
          nx = Math.sign(x); ny = 0;
        } else {
          nx = 0; ny = Math.sign(y);
        }
        dx = -nx * mag;
        dy = -ny * mag;
      }
      const o = (j * cw + i) * 4;
      img.data[o] = Math.round(128 + dx * 127);
      img.data[o + 1] = Math.round(128 + dy * 127);
      img.data[o + 2] = 128;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL();
  if (maps.size > 60) maps.clear();
  maps.set(key, url);
  return url;
}

type Props = {
  /** Corner radius of the glass element, in px. */
  radius: number;
  /** Width of the bending band at the edge, in px. */
  bezel?: number;
  /** How far the edge pulls the backdrop, in px. */
  strength?: number;
  /** Frost behind the glass, in px. */
  blur?: number;
  /** Colour boost of what shows through. */
  saturate?: number;
  /** Tint painted inside the glass. */
  tint?: string;
  /** Bend the backdrop at the edges. Costly: every frame of anything moving
      behind re-runs the SVG filter, so keep it to small, static elements. */
  refract?: boolean;
};

export default function GlassLens({ radius, bezel = 16, strength = 34, blur = 8, saturate = 1.8, tint = "var(--lg-tint)", refract = false }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const id = "lg" + useId().replace(/[^a-zA-Z0-9]/g, "");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !SVG_BACKDROP || !refract) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [refract]);

  const href = refract && size && size.w > 0 && size.h > 0 ? displacementMap(size.w, size.h, radius, bezel) : "";
  const tone = " saturate(" + saturate + ") brightness(1.04)";
  const filter = href ? "url(#" + id + ") blur(" + blur + "px)" + tone : "blur(" + blur + "px)" + tone;

  return (
    <span
      ref={ref}
      aria-hidden="true"
      style={{
        position: "absolute", inset: 0, zIndex: -1, borderRadius: "inherit", pointerEvents: "none",
        background: tint, backdropFilter: filter, WebkitBackdropFilter: filter,
      }}
    >
      {href && size && (
        <svg width="0" height="0" style={{ position: "absolute" }}>
          <filter id={id} x="0" y="0" width={size.w} height={size.h} filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
            <feImage href={href} x="0" y="0" width={size.w} height={size.h} preserveAspectRatio="none" result="map" />
            <feDisplacementMap in="SourceGraphic" in2="map" scale={strength} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      )}
    </span>
  );
}
