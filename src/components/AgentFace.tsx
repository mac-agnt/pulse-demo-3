import { css } from "../runtime/template";
import LiveOrb, { type LiveOrbMood } from "./ui/live-orb";

/* An agent's face: a LiveOrb in the agent's own colour whose eyes follow the
   pointer. State is carried by the eyes, never the colour:
   complete = happy squint, waiting = half-lidded, attention = wide open,
   thinking = glancing up, idle/working = open and blinking.
   The shape id picks the silhouette and eye spacing. */

const SHAPES: Record<string, { squash: [number, number]; gap: number }> = {
  "crown-pebble":      { squash: [1, 1],       gap: 0.32 },
  "executive-capsule": { squash: [1, 0.86],    gap: 0.34 },
  "shield":            { squash: [0.9, 1],     gap: 0.3 },
  "glass-visor":       { squash: [1, 0.8],     gap: 0.36 },
  "control-cube":      { squash: [0.96, 0.96], gap: 0.3 },
  "low-dome":          { squash: [1, 0.74],    gap: 0.38 },
  "offset-pebble":     { squash: [1, 0.82],    gap: 0.28 },
  "rim-capsule":       { squash: [0.92, 0.96], gap: 0.34 },
  "wide-eyed":         { squash: [1, 0.94],    gap: 0.4 },
  "precision-brow":    { squash: [0.94, 0.9],  gap: 0.26 },
  "tall-unit":         { squash: [0.72, 1],    gap: 0.26 },
  "soft-asymmetric":   { squash: [0.98, 0.9],  gap: 0.32 }
};

const MOODS: Record<string, LiveOrbMood> = {
  complete: "happy", waiting: "half", attention: "wide", thinking: "thinking"
};

type FaceProps = {
  shape?: string;
  state?: string;
  tint?: string;
  size?: number | string;
  /** Position-only styles placed on the host wrapper. */
  hostStyle?: string | Record<string, string>;
};

// Light shells (amber, mint) get ink eyes; everything else gets white eyes.
function eyeColour(tint: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(tint.trim());
  if (!m) return "#fbfaf6";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255);
  return L > 0.42 ? "#16171a" : "#fbfaf6";
}

const HOST_STYLE_PROPS = new Set(["position", "left", "right", "top", "bottom", "inset", "width", "height", "z-index", "transform"]);

function hostPositionStyle(style: FaceProps["hostStyle"]) {
  const all = css(style);
  if (!all) return undefined;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(all)) {
    if (HOST_STYLE_PROPS.has(k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()))) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export default function AgentFace(props: FaceProps) {
  const size = Math.max(1, Number(props.size) || 40);
  const s = (props.shape && SHAPES[props.shape]) || SHAPES["crown-pebble"];
  const tint = props.tint || "#191c1f";
  return (
    <div className="sc-host" data-sc-name="AgentFace" style={hostPositionStyle(props.hostStyle)}>
      <LiveOrb size={size} variant="custom" color={tint} eyeColor={eyeColour(tint)}
        mood={MOODS[props.state ?? ""] ?? "open"} squash={s.squash} eyeGap={s.gap}
        label="Agent" style={{ display: "block" }} />
    </div>
  );
}
