/**
 * Soft bottom edge fade along the bottom viewport boundary.
 * Uses a single compositor-only linear gradient (zero backdrop-filter GPU readbacks)
 * so scrolling stays smooth across laptops and high-DPI screens.
 */
export function BottomBlur() {
  return (
    <div
      className="bottom-blur-stick"
      aria-hidden
      style={{
        background: "linear-gradient(to top, rgba(245, 246, 247, 0.72) 0%, rgba(245, 246, 247, 0) 100%)",
      }}
    />
  );
}
