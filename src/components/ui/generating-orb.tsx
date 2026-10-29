import type { CSSProperties } from "react";

/* Generating orb: a soft lit sphere with a rim of coloured light sweeping
   round it, and a word inside whose letters pop in a staggered wave.

   Rebuilt from the 21st.dev component's props and look (its renderer files
   were not part of the paste). CSS only; the canvas renderer is not included,
   so `renderer="canvas"` draws the CSS one. Colours ease between the main and
   `Alt` palettes; change `text` and the new word fades in and restarts the
   wave. */

export type GeneratingOrbProps = {
  renderer?: "css" | "canvas";
  /** Diameter in px. */
  size?: number;
  /** How far the rim light reaches in, 0.5 to 1.5. */
  depth?: number;
  /** Rim sweep and colour drift speed multiplier. */
  speed?: number;
  /** One letter wave, in ms. */
  duration?: number;
  /** Delay between letters, in ms. */
  stagger?: number;
  /** Peak letter scale. */
  pop?: number;
  /** Letter opacity between pops. */
  restOpacity?: number;
  /** Text size multiplier. */
  textSize?: number;
  /** Letter spacing, in em. */
  tracking?: number;
  text?: string;
  showText?: boolean;
  highlightColor?: string;
  haloColor?: string;
  coreColor?: string;
  haloColorAlt?: string;
  coreColorAlt?: string;
  /** A third light that drifts through the rim. Defaults to haloColorAlt. */
  accentColor?: string;
  textColor?: string;
  playback?: "play" | "pause";
  className?: string;
  style?: CSSProperties;
};

const CSS = `
@property --go-halo-now { syntax: "<color>"; inherits: true; initial-value: #3d7bff; }
@property --go-core-now { syntax: "<color>"; inherits: true; initial-value: #1f4fe0; }
.go { position: relative; border-radius: 50%; isolation: isolate; flex: none;
  animation: goTint calc(9s / var(--go-speed)) ease-in-out infinite alternate; animation-play-state: var(--go-play); }
@keyframes goTint {
  from { --go-halo-now: var(--go-halo); --go-core-now: var(--go-core); }
  to   { --go-halo-now: var(--go-halo-alt); --go-core-now: var(--go-core-alt); }
}
/* Outside: a coloured bloom, and a soft shadow underneath so it floats. */
.go::before { content: ""; position: absolute; inset: 0; border-radius: 50%; z-index: -1;
  box-shadow:
    0 0 calc(var(--go-s) * .09) color-mix(in oklab, var(--go-halo-now) 45%, transparent),
    0 0 calc(var(--go-s) * .3) color-mix(in oklab, var(--go-core-now) 18%, transparent),
    0 calc(var(--go-s) * .1) calc(var(--go-s) * .22) calc(var(--go-s) * -.06) rgba(12, 28, 90, .16); }

/* Colour: blurred lights drifting round inside the rim. Masked to the outer
   band, so the heart of the sphere stays clear. */
.go-lights { position: absolute; inset: 0; border-radius: 50%; overflow: hidden;
  background: color-mix(in oklab, var(--go-halo-now) 30%, transparent);
  -webkit-mask-image: radial-gradient(circle, transparent 26%, #000 70%);
  mask-image: radial-gradient(circle, transparent 26%, #000 70%); }
.go-orbit { position: absolute; inset: 0; animation: goSpin var(--go-t) linear infinite; animation-play-state: var(--go-play); }
.go-orbit > i { opacity: .8; position: absolute; left: 50%; top: 50%; width: 78%; height: 78%; border-radius: 50%;
  background: radial-gradient(closest-side, var(--c), transparent 72%);
  filter: blur(calc(var(--go-s) * .045)); transform: translate(-50%, -50%) translate(var(--dx), var(--dy)); }
.go-orbit.o1 { --go-t: calc(7s / var(--go-speed)); }
.go-orbit.o1 > i { --c: var(--go-halo-now); --dx: calc(var(--go-s) * -.3); --dy: calc(var(--go-s) * -.08); }
.go-orbit.o2 { --go-t: calc(10s / var(--go-speed)); animation-direction: reverse; }
.go-orbit.o2 > i { --c: var(--go-core-now); --dx: calc(var(--go-s) * .28); --dy: calc(var(--go-s) * .16); width: 70%; height: 70%; }
.go-orbit.o3 { --go-t: calc(13s / var(--go-speed)); }
.go-orbit.o3 > i { --c: var(--go-accent); --dx: calc(var(--go-s) * .06); --dy: calc(var(--go-s) * .32); width: 56%; height: 56%; opacity: .6; }
@keyframes goSpin { to { transform: rotate(360deg); } }

/* Glass body: frosted, lightest at the heart, thinning toward the rim. */
.go-body { position: absolute; inset: 0; border-radius: 50%;
  background: radial-gradient(circle at 46% 42%,
    color-mix(in oklab, var(--go-hi) 34%, transparent) 0%,
    color-mix(in oklab, var(--go-hi) 20%, transparent) 34%,
    color-mix(in oklab, var(--go-hi) 6%, transparent) 62%,
    transparent 82%);
  -webkit-backdrop-filter: blur(calc(var(--go-s) * .018)) saturate(1.5);
  backdrop-filter: blur(calc(var(--go-s) * .018)) saturate(1.5); }
/* Directional rim light that turns slowly, so one side always burns brighter. */
.go-rim { position: absolute; inset: 0; border-radius: 50%;
  box-shadow: inset calc(var(--go-s) * .05 * var(--go-depth)) calc(var(--go-s) * .02 * var(--go-depth)) calc(var(--go-s) * .09 * var(--go-depth)) 0 color-mix(in oklab, var(--go-core-now) 70%, transparent);
  filter: blur(calc(var(--go-s) * .01));
  animation: goSpin calc(8s / var(--go-speed)) linear infinite reverse; animation-play-state: var(--go-play); }
/* Glass edge: a bright lip on top, a faint one below. */
.go-edge { position: absolute; inset: 0; border-radius: 50%;
  box-shadow: inset 0 calc(var(--go-s) * .006) calc(var(--go-s) * .006) rgba(255, 255, 255, .85),
              inset 0 calc(var(--go-s) * -.012) calc(var(--go-s) * .03) rgba(255, 255, 255, .35),
              inset 0 0 0 1px rgba(255, 255, 255, .22); }
/* Highlights: a crisp one top left, a broad bloom, and a reflection low down. */
.go-sheen { position: absolute; left: 20%; top: 11%; width: 30%; height: 15%; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(255, 255, 255, .95), rgba(255, 255, 255, 0));
  transform: rotate(-24deg); filter: blur(calc(var(--go-s) * .006)); }
.go-bloom { position: absolute; left: 12%; top: 6%; width: 60%; height: 42%; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(255, 255, 255, .28), transparent); filter: blur(calc(var(--go-s) * .03)); }
.go-caustic { position: absolute; left: 26%; bottom: 7%; width: 48%; height: 12%; border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in oklab, var(--go-hi) 70%, transparent), transparent);
  filter: blur(calc(var(--go-s) * .012)); opacity: .8; }

.go-text { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  padding: 0 14%; text-align: center; font-family: var(--ui, system-ui, sans-serif);
  font-size: calc(var(--go-s) * .082 * var(--go-text-size)); font-weight: 500; letter-spacing: calc(var(--go-tracking) - .01em);
  color: var(--go-text); white-space: nowrap; text-shadow: 0 1px 10px rgba(8, 20, 60, .45), 0 0 2px rgba(8, 20, 60, .25);
  animation: goWordIn .4s cubic-bezier(.16,1,.3,1) both; }
@keyframes goWordIn { from { opacity: 0; transform: translateY(5px); filter: blur(2px); } to { opacity: 1; transform: none; filter: none; } }
.go-letter { display: inline-block; white-space: pre; opacity: var(--go-rest);
  animation: goLetter var(--go-dur) ease-in-out infinite; animation-play-state: var(--go-play); }
@keyframes goLetter {
  0%, 100% { opacity: var(--go-rest); transform: translateY(0) scale(1); }
  20% { opacity: 1; transform: translateY(-4%) scale(var(--go-pop)); }
  40% { opacity: calc(var(--go-rest) + (1 - var(--go-rest)) * .6); transform: translateY(0) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .go, .go-rim, .go-orbit, .go-letter { animation: none !important; }
  .go-letter { opacity: 1; }
}
`;

export function GeneratingOrb({
  size = 240, depth = 1, speed = 1, duration = 2000, stagger = 100, pop = 1.15, restOpacity = 0.4,
  textSize = 1, tracking = 0, text = "Generating", showText = true,
  highlightColor = "#ffffff", haloColor = "#ad5fff", coreColor = "#471eec",
  haloColorAlt = "#d60a47", coreColorAlt = "#311e80", accentColor, textColor = "#ffffff",
  playback = "play", className, style,
}: GeneratingOrbProps) {
  return (
    <div
      className={className ? "go " + className : "go"}
      role="status"
      aria-live="polite"
      aria-label={showText ? text : undefined}
      style={{
        width: size, height: size,
        "--go-s": size + "px",
        "--go-depth": depth,
        "--go-speed": Math.max(0.05, speed),
        "--go-dur": duration + "ms",
        "--go-pop": pop,
        "--go-rest": restOpacity,
        "--go-text-size": textSize,
        "--go-tracking": tracking + "em",
        "--go-hi": highlightColor,
        "--go-halo": haloColor,
        "--go-core": coreColor,
        "--go-halo-alt": haloColorAlt,
        "--go-core-alt": coreColorAlt,
        "--go-accent": accentColor ?? haloColorAlt,
        "--go-text": textColor,
        "--go-play": playback === "pause" ? "paused" : "running",
        ...style,
      } as CSSProperties}
    >
      <style>{CSS}</style>
      <div className="go-lights">
        <div className="go-orbit o1"><i /></div>
        <div className="go-orbit o2"><i /></div>
        <div className="go-orbit o3"><i /></div>
      </div>
      <div className="go-body" />
      <div className="go-rim" />
      <div className="go-edge" />
      <div className="go-bloom" />
      <div className="go-sheen" />
      <div className="go-caustic" />
      {showText && (
        <div className="go-text" key={text} aria-hidden="true">
          {text.split("").map((ch, i) => (
            <span key={i} className="go-letter" style={{ animationDelay: i * stagger + "ms" }}>{ch}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default GeneratingOrb;
