
/**
 * Arcade bottom-blur — exact replica of the 8-layer progressive backdrop-blur.
 * Extracted from arcade.software's .bottom-blur-stick inline HTML.
 * Each layer has increasing blur (0.078px → 10px) with staggered mask gradients.
 * Fixed to viewport bottom, 120px tall, z-index 8, pointer-events none.
 */
const LAYERS = [
  { blur: "0.078125px", mask: "linear-gradient(rgba(0,0,0,0) 0%, rgb(0,0,0) 12.5%, rgb(0,0,0) 25%, rgba(0,0,0,0) 37.5%)" },
  { blur: "0.15625px", mask: "linear-gradient(rgba(0,0,0,0) 12.5%, rgb(0,0,0) 25%, rgb(0,0,0) 37.5%, rgba(0,0,0,0) 50%)" },
  { blur: "0.3125px", mask: "linear-gradient(rgba(0,0,0,0) 25%, rgb(0,0,0) 37.5%, rgb(0,0,0) 50%, rgba(0,0,0,0) 62.5%)" },
  { blur: "0.625px", mask: "linear-gradient(rgba(0,0,0,0) 37.5%, rgb(0,0,0) 50%, rgb(0,0,0) 62.5%, rgba(0,0,0,0) 75%)" },
  { blur: "1.25px", mask: "linear-gradient(rgba(0,0,0,0) 50%, rgb(0,0,0) 62.5%, rgb(0,0,0) 75%, rgba(0,0,0,0) 87.5%)" },
  { blur: "2.5px", mask: "linear-gradient(rgba(0,0,0,0) 62.5%, rgb(0,0,0) 75%, rgb(0,0,0) 87.5%, rgba(0,0,0,0) 100%)" },
  { blur: "5px", mask: "linear-gradient(rgba(0,0,0,0) 75%, rgb(0,0,0) 87.5%, rgb(0,0,0) 100%)" },
  { blur: "10px", mask: "linear-gradient(rgba(0,0,0,0) 87.5%, rgb(0,0,0) 100%)" },
];

export function BottomBlur() {
  return (
    <div className="bottom-blur-stick" aria-hidden>
      <div>
        {LAYERS.map((layer, i) => (
          <div
            key={i}
            className="blur-layer"
            style={{
              zIndex: i + 1,
              backdropFilter: `blur(${layer.blur})`,
              WebkitBackdropFilter: `blur(${layer.blur})`,
              maskImage: layer.mask,
              WebkitMaskImage: layer.mask,
            }}
          />
        ))}
      </div>
    </div>
  );
}
