import { memo } from "react";

/* The asleep wallpaper: folds of dark navy silk under a ridge of orange
   dunes, shown full screen behind the clock and faded out on waking. */

function SilkWallpaper({ on }: { on: boolean }) {
  return (
    <div className="jv-silk" data-on={on ? "1" : "0"} aria-hidden="true">
      <img src="/wallpapers/silk.webp" alt="" decoding="async" />
    </div>
  );
}

export default memo(SilkWallpaper);
