import { memo } from "react";
import { WALLPAPERS, useWallpaper } from "./wallpapers";

/* A macOS-style wallpaper: deep blue field with soft light ribbons sweeping
   across it. It is handed to the browser as an image, not live SVG, so its
   heavy blurs are rasterised once instead of on every repaint of the glass
   above it. */
const SVG = '<svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" width="1600" height="1000" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="wp-foam" x1="0" y1="0" x2="1" y2="0.4"><stop offset="0" stop-color="#ffffff" stop-opacity="0" /><stop offset="0.35" stop-color="#ffffff" stop-opacity=".95" /><stop offset="0.7" stop-color="#cfe6ff" stop-opacity=".8" /><stop offset="1" stop-color="#ffffff" stop-opacity="0" /></linearGradient><filter id="wp-b40" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="40" /></filter><filter id="wp-b14" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="14" /></filter><filter id="wp-b3" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" /></filter></defs><rect width="1600" height="1000" fill="#6c97cf" /><path d="M-150 540 C 240 360, 560 300, 860 400 S 1320 640, 1750 430" fill="none" stroke="#8fbaf0" stroke-width="140" stroke-linecap="round" opacity=".45" filter="url(#wp-b40)" /><path d="M-120 500 C 260 330, 560 270, 870 370 S 1330 600, 1760 390" fill="none" stroke="url(#wp-foam)" stroke-width="46" stroke-linecap="round" opacity=".45" filter="url(#wp-b14)" /><path d="M-100 492 C 270 325, 565 262, 872 362 S 1335 592, 1760 382" fill="none" stroke="#f4faff" stroke-width="3" stroke-linecap="round" opacity=".6" filter="url(#wp-b3)" /><path d="M-160 880 C 140 750, 390 690, 648 770 S 1010 965, 1310 1025" fill="none" stroke="url(#wp-foam)" stroke-width="18" stroke-linecap="round" opacity=".45" filter="url(#wp-b14)" /></svg>';
const SRC = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(SVG);

/** The built-in liquid wallpaper, for the picker's preview. */
export const LIQUID_SRC = SRC;

function LiquidWallpaper() {
  const id = useWallpaper();
  const src = id === "liquid" ? SRC : WALLPAPERS.find((w) => w.id === id)?.src || SRC;
  return (
    <div aria-hidden="true" className="lg-wallpaper">
      <img key={id} src={src} alt="" decoding="async" className="lg-wallpaper-img" />
    </div>
  );
}

export default memo(LiquidWallpaper);
