import { Fragment, useEffect, useRef, useState } from "react";
import GlassLens from "./GlassLens";

/* The app's navigation, folded into one glass button at the bottom left.
   Pressing it grows the button upward along the left side into a column of
   page buttons (Home nearest the button);
   picking a page, pressing Escape or clicking away folds it back.
   Order comes straight from the logic's NAV (Home, then Agents, then the rest). */

type NavItem = {
  isItem?: boolean;
  label?: string;
  d?: string;
  active?: boolean;
  dot?: boolean;
  go?: () => void;
};

type Props = {
  items: NavItem[];
  settingsActive: boolean;
  onSettings: () => void;
};

const SLOT = 48;
const GAP = 4;
const PAD = 6;
const DIVIDER = 13;
const SETTINGS_ICON = "M5.5 20v-5.5 M5.5 9.5V4 M12 20v-7.5 M12 7.5V4 M18.5 20v-4 M18.5 11V4 M3 12.5h5 M9.5 5.5h5 M16 14h5";

export default function GlassDock({ items, settingsActive, onSettings }: Props) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pages = items.filter((i) => i.isItem);
  const entries = pages
    .map((p) => ({ label: p.label ?? "", d: p.d ?? "", active: !!p.active, dot: !!p.dot, go: p.go }))
    .concat([{ label: "Settings", d: SETTINGS_ICON, active: settingsActive, dot: false, go: onSettings }]);
  const count = entries.length;
  const openHeight = PAD * 2 + SLOT * (count + 1) + GAP * count + DIVIDER;
  // Distance from the dock's bottom edge to the middle of each item.
  const slotMid = (i: number) => PAD + SLOT + GAP + i * (SLOT + GAP) + (i === count - 1 ? DIVIDER : 0) + SLOT / 2;
  const current = entries.find((e) => e.active);

  return (
    <div ref={wrap} className="lg-dock" data-open={open ? "1" : "0"}>
      {open && hover !== null && entries[hover] && (
        <span className="lg-dock-tip lg" style={{ bottom: slotMid(hover) }}>
          <GlassLens radius={12} bezel={8} strength={14} blur={6} tint="var(--lg-tint-strong)" />
          {entries[hover].label}
        </span>
      )}
      <nav
        aria-label="Pages"
        className="lg lg-dock-tray"
        style={{ height: open ? openHeight : SLOT + PAD * 2 }}
      >
        <GlassLens radius={30} bezel={18} strength={40} blur={7} refract />
        <button
          type="button"
          className="lg-dock-launch"
          aria-expanded={open}
          aria-label={open ? "Close pages" : "Open pages" + (current ? ", on " + current.label : "")}
          onClick={() => { setOpen((o) => !o); setHover(null); }}
        >
          <svg className="lg-dock-grid" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <rect x="4" y="4" width="6.5" height="6.5" rx="2" />
            <rect x="13.5" y="4" width="6.5" height="6.5" rx="2" />
            <rect x="4" y="13.5" width="6.5" height="6.5" rx="2" />
            <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" />
          </svg>
          <svg className="lg-dock-close" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M7 7l10 10 M17 7 7 17" />
          </svg>
        </button>
        {entries.map((e, i) => (
          <Fragment key={e.label}>
            {i === count - 1 && <span className="lg-dock-divider" aria-hidden="true" style={{ transitionDelay: open ? i * 26 + "ms" : "0ms" }} />}
            <button
              type="button"
              className="lg-dock-item"
              data-active={e.active ? "1" : "0"}
              aria-label={e.label}
              aria-current={e.active ? "page" : undefined}
              tabIndex={open ? 0 : -1}
              style={{ transitionDelay: open ? 40 + i * 26 + "ms" : "0ms" }}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover((h) => (h === i ? null : h))}
              onFocus={() => setHover(i)}
              onBlur={() => setHover((h) => (h === i ? null : h))}
              onClick={() => { e.go?.(); setOpen(false); setHover(null); }}
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d={e.d} />
              </svg>
              {e.dot && <span className="lg-dock-dot" aria-hidden="true" />}
            </button>
          </Fragment>
        ))}
      </nav>
    </div>
  );
}
