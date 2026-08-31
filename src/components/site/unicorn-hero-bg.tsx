"use client";

import * as React from "react";

/**
 * Unicorn Studio hero background — exact replica of arcade.software's setup.
 *
 * Arcade loads: unicornStudio.umd.js v1.4.34 from jsdelivr
 * Config on .gradient-inside:
 *   data-us-project-src = aleks.json.txt (the flow-field shader scene)
 *   data-us-dpi = 1.5, data-us-scale = 1, data-us-production = true
 *
 * The scene contains 2 layers:
 *   1. Base image texture (the blue gradient PNG)
 *   2. flowField effect layer (Perlin-noise UV warping, speed 0.09, animating)
 *
 * We load the same UMD file (served from /public) and init it the same way.
 */

declare global {
  interface Window {
    UnicornStudio?: {
      isInitialized: boolean;
      init: (opts?: { root?: string }) => void;
    };
  }
}

export function UnicornHeroBg() {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = React.useState(false);

  // Load the UMD script exactly like arcade does (inline script that appends to head)
  React.useEffect(() => {
    if (window.UnicornStudio) {
      if (!window.UnicornStudio.isInitialized) {
        window.UnicornStudio.init();
        window.UnicornStudio.isInitialized = true;
      }
      setLoaded(true);
      return;
    }

    const script = document.createElement("script");
    script.src = "/unicornStudio.umd.js";
    script.async = true;
    script.onload = () => {
      if (window.UnicornStudio && !window.UnicornStudio.isInitialized) {
        window.UnicornStudio.init();
        window.UnicornStudio.isInitialized = true;
        setLoaded(true);
      }
    };
    (document.head || document.body).appendChild(script);

    return () => {
      // Unicorn Studio doesn't expose a destroy in the UMD global; canvas will be
      // removed with the DOM node on unmount.
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="unicorn-hero-bg absolute inset-0"
      data-us-project-src="/arcade-us-project.json"
      data-us-dpi="1.5"
      data-us-scale="1"
      data-us-production="true"
      aria-hidden
    />
  );
}
