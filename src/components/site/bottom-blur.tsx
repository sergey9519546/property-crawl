
/**
 * Arcade bottom-blur — progressive backdrop-blur ramp at the viewport bottom.
 * Extracted from arcade.software's .bottom-blur-stick inline HTML.
 * Fixed to viewport bottom, 120px tall, z-index 8, pointer-events none.
 *
 * Reduced from 8 stacked backdrop-filter layers to 4. backdrop-filter forces
 * the compositor to read back everything painted behind the layer, so cost
 * tracks layer count rather than total blur radius — halving the layers
 * roughly halves the readbacks over the same 1440x120 band.
 *
 * The four radii reproduce the original 8-layer composite. Stacked layers add,
 * and each mask weights its layer's contribution, so summing the pairs that
 * are live at each quarter of the band gives the composite ramp:
 *
 *   y=25%   0.078 + 0.156   = 0.234
 *   y=50%   0.3125 + 0.625  = 0.781
 *   y=75%   1.25 + 2.5      = 3.75
 *   y=100%  5 + 10          = 15
 *
 * Back-solving those four sums for a 4-layer stack (b1, b1+b2, b2+b3, b3+b4)
 * gives 0.23 / 0.55 / 3.20 / 11.80, which is what these masks render.
 */
const LAYERS = [
  { blur: "0.23px", mask: "linear-gradient(rgba(0,0,0,0) 0%, rgb(0,0,0) 25%, rgb(0,0,0) 50%, rgba(0,0,0,0) 75%)" },
  { blur: "0.55px", mask: "linear-gradient(rgba(0,0,0,0) 25%, rgb(0,0,0) 50%, rgb(0,0,0) 75%, rgba(0,0,0,0) 100%)" },
  { blur: "3.2px", mask: "linear-gradient(rgba(0,0,0,0) 50%, rgb(0,0,0) 75%, rgb(0,0,0) 100%)" },
  { blur: "11.8px", mask: "linear-gradient(rgba(0,0,0,0) 75%, rgb(0,0,0) 100%)" },
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
