import { useSyncExternalStore } from "react";

/* Wallpaper choice: a tiny store the wallpaper layer and the picker share.
   The pick is remembered per browser (localStorage); anything that fails
   there just falls back to the default. */

export type WallpaperId = "liquid" | "dunes" | "waves";

/* Silk dunes: a molten orange sheet over deep navy folds. Drawn as one SVG
   and handed over as an image, so its blurs rasterise once. */
const DUNES = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" width="1600" height="1000">
<defs>
<linearGradient id="or" x1="0" y1="0" x2="0.2" y2="1"><stop offset="0" stop-color="#ff7a2e"/><stop offset=".55" stop-color="#f25a17"/><stop offset="1" stop-color="#c83e0b"/></linearGradient>
<linearGradient id="nv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d2b40"/><stop offset="1" stop-color="#070c15"/></linearGradient>
<linearGradient id="f1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34465f"/><stop offset=".35" stop-color="#1c2a3e"/><stop offset="1" stop-color="#0c1421"/></linearGradient>
<linearGradient id="f2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2c3d55"/><stop offset=".4" stop-color="#172336"/><stop offset="1" stop-color="#0a111c"/></linearGradient>
<linearGradient id="f3" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26364c"/><stop offset=".45" stop-color="#121c2c"/><stop offset="1" stop-color="#060b13"/></linearGradient>
<filter id="b30" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="30"/></filter>
<filter id="b12" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="12"/></filter>
<filter id="b4" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="4"/></filter>
</defs>
<rect width="1600" height="1000" fill="url(#nv)"/>
<path d="M0 0H1600V560C1480 520 1360 470 1220 430C1060 385 900 330 740 250C560 160 360 120 180 110C110 106 50 110 0 118Z" fill="url(#or)"/>
<path d="M-40 40C260 20 520 60 760 150C980 232 1180 300 1640 330" fill="none" stroke="#ff9a5c" stroke-width="70" opacity=".45" filter="url(#b30)"/>
<path d="M200 -20C520 10 760 80 980 170C1180 250 1380 290 1640 300" fill="none" stroke="#a8300a" stroke-width="60" opacity=".45" filter="url(#b30)"/>
<path d="M600 -30C860 40 1060 120 1260 180C1420 228 1540 250 1640 250" fill="none" stroke="#ffb07a" stroke-width="40" opacity=".4" filter="url(#b30)"/>
<path d="M-20 170C220 150 440 190 660 280C880 370 1100 440 1640 520" fill="none" stroke="#b33609" stroke-width="80" opacity=".5" filter="url(#b30)"/>
<path d="M0 150C200 140 420 175 640 262C860 350 1060 420 1300 470C1440 500 1540 540 1600 560V1000H0Z" fill="url(#f1)"/>
<path d="M0 158C220 150 440 186 650 270C860 354 1070 426 1320 478C1460 506 1560 540 1600 556" fill="none" stroke="#5a7294" stroke-width="3" opacity=".7" filter="url(#b4)"/>
<path d="M0 310C180 300 360 330 560 410C760 490 980 560 1240 610C1400 640 1520 680 1600 720V1000H0Z" fill="url(#f2)" filter="url(#b4)"/>
<path d="M0 312C180 304 370 334 570 412C770 490 990 560 1250 610C1410 640 1530 682 1600 718" fill="none" stroke="#4b6284" stroke-width="3" opacity=".6" filter="url(#b4)"/>
<path d="M0 470C200 450 400 480 600 560C820 648 1060 720 1320 770C1460 796 1560 830 1600 860V1000H0Z" fill="url(#f3)" filter="url(#b4)"/>
<path d="M0 472C200 454 402 484 604 562C822 650 1062 722 1322 772C1462 798 1562 832 1600 858" fill="none" stroke="#3f5577" stroke-width="3" opacity=".55" filter="url(#b4)"/>
<path d="M0 640C220 610 440 640 660 720C880 800 1120 870 1600 950V1000H0Z" fill="#060a12" opacity=".85" filter="url(#b12)"/>
<path d="M0 560C300 520 560 600 760 700" fill="none" stroke="#2a3a52" stroke-width="40" opacity=".5" filter="url(#b30)"/>
<rect width="1600" height="1000" fill="#000" opacity=".08"/>
</svg>`;

export const WALLPAPERS: { id: WallpaperId; name: string; src: string }[] = [
  { id: "liquid", name: "Liquid", src: "" },
  { id: "dunes", name: "Dunes", src: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(DUNES) },
  { id: "waves", name: "Waves", src: "/wallpapers/waves.webp" },
];

const KEY = "pulse.wallpaper";
let current: WallpaperId = (() => {
  try {
    const v = window.localStorage.getItem(KEY);
    return WALLPAPERS.some((w) => w.id === v) ? (v as WallpaperId) : "liquid";
  } catch {
    return "liquid";
  }
})();
const listeners = new Set<() => void>();

export function setWallpaper(id: WallpaperId) {
  current = id;
  try { window.localStorage.setItem(KEY, id); } catch { /* private mode: keep it for this visit */ }
  listeners.forEach((l) => l());
}

export function useWallpaper(): WallpaperId {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => current,
  );
}
