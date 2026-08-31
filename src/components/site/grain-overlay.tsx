
/**
 * Global grain overlay — subtle film grain texture at 3.5% opacity.
 * Uses SVG feTurbulence noise, mix-blend-mode: overlay.
 * Fixed position, pointer-events none, z-9999 (above everything).
 */
export function GrainOverlay() {
  return <div className="grain-overlay" aria-hidden />;
}
