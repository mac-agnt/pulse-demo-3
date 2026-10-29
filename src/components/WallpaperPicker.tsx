import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import GlassLens from "./GlassLens";
import { LIQUID_SRC } from "./LiquidWallpaper";
import { WALLPAPERS, setWallpaper, useWallpaper } from "./wallpapers";

/* The "+" in the top bar: opens a glass sheet of wallpapers under it.
   The header pill clips overflow, so the sheet is portalled into the themed
   app root and placed from the button's position. */
export default function WallpaperPicker() {
  const current = useWallpaper();
  const btn = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (r) setAt({ top: r.bottom + 10, right: Math.max(12, window.innerWidth - r.right - 8) });
    };
    place();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!sheet.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    window.addEventListener("resize", place);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const root = btn.current?.closest("[data-theme]") ?? null;

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="ix2 wp-btn"
        aria-label="Change background"
        aria-expanded={open}
        title="Change background"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14 M5 12h14" />
        </svg>
      </button>
      {open && root && createPortal(
        <div ref={sheet} className="lg wp-sheet" role="dialog" aria-label="Background" style={{ top: at.top, right: at.right }}>
          <GlassLens radius={22} blur={16} saturate={1.3} tint="var(--lg-window-tint,rgba(16,22,38,.6))" />
          <div className="wp-title">Background</div>
          <div className="wp-grid">
            {WALLPAPERS.map((w) => (
              <button
                key={w.id}
                type="button"
                className="wp-item"
                aria-pressed={current === w.id}
                onClick={() => setWallpaper(w.id)}
              >
                <span className="wp-thumb"><img src={w.id === "liquid" ? LIQUID_SRC : w.src} alt="" /></span>
                <span className="wp-name">{w.name}</span>
              </button>
            ))}
          </div>
        </div>,
        root,
      )}
    </>
  );
}
