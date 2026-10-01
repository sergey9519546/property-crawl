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

  // Load the UMD script exactly like arcade does (inline script that appends to head)
  React.useEffect(() => {
    // Feature-detect on a 1x1 canvas rather than a full-size one.
    //
    // getContext() is not free: it stands up a whole GL context, allocates
    // driver resources and, on many stacks, synchronises with the GPU process.
    // Doing that on a default-size canvas purely to ask "is WebGL available?"
    // cost real milliseconds on every single page load, and the canvas was then
    // discarded unused. A 1x1 probe asks the same question for a fraction of
    // the setup, and is the conventional way to do it.
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    const gl = probe.getContext("webgl2") || probe.getContext("webgl");
    if (!gl) return;

    const rendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = rendererInfo
      ? String(gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) || "")
      : "";
    if (/swiftshader|software/i.test(renderer)) return;

    // Release the probe's context immediately; the shader canvas is created by
    // UnicornStudio itself, and only when it initialises.
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();

    if (window.UnicornStudio) {
      if (!window.UnicornStudio.isInitialized) {
        try {
          window.UnicornStudio.init();
          window.UnicornStudio.isInitialized = true;
        } catch {
          return;
        }
      }
      return;
    }

    const script = document.createElement("script");
    script.src = "/unicornStudio.umd.js";
    script.async = true;
    script.onload = () => {
      if (window.UnicornStudio && !window.UnicornStudio.isInitialized) {
        try {
          window.UnicornStudio.init();
          window.UnicornStudio.isInitialized = true;
        } catch {
          // The local hero image remains visible when shader initialization fails.
        }
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
      className="unicorn-hero-bg absolute inset-0 z-[1]"
      data-us-project-src="/arcade-us-project.json"
      data-us-dpi="1.5"
      data-us-scale="1"
      data-us-production="true"
      aria-hidden
    />
  );
}
