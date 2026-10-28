# PerfectProperty design system: evidence ink

Live specimen: `/design` (not indexed). Source of truth for tokens: the `@theme` block and the "Evidence ink" block in `src/app/globals.css`. Rules for missing values: `src/lib/evidence.ts`. Components: `src/components/evidence/`.

## 1. The insight

Auction buyers act on incomplete information, and the facts that are missing matter more than the facts that are shown. Most interfaces draw a missing value as empty space or a dash. A clean-looking listing then quietly reads as a safe one.

Our brand promise is "Every deal has a catch. We show it first." The design system exists to keep that promise in pixels: a gap must look like something, as loud as a fact, never quieter.

## 2. Principles

1. **A gap is drawn, not hidden.** A missing value keeps the same footprint as a real one and is never collapsed or dimmed. Why: empty space reads as "nothing to worry about". Do: show "Not in the notice" where the deposit would be. Don't: show a dash, or drop the row.
2. **Every value has an origin, and the origin is visible.** Printed, yours, or unknown. Why: a buyer's guess that looks like a published fact is the most expensive mistake on the page. Do: mark a typed estimate with the pencil style and "yours". Don't: render an estimate in plain ink.
3. **The caller never chooses "unknown".** Unknown is what a missing value becomes. Why: if a developer can pick it, a developer can style it away. Do: pass the raw value to `Fact`. Don't: add an `unknown` prop or pre-format a fallback string.
4. **Colour is spent on evidence, not mood.** Amber means the catch, indigo means yours, green means an action or "live". Everything else is ink, paper and lines. Why: green reads as safe, and nothing here is safe by default. Do: use green for a button. Don't: use green for "good deal" or "verified".
5. **A derived number is only as strong as its weakest input (weakest-link rule).** Built on any guess, it is "yours". With a required input missing, it is unknown. Why: arithmetic launders weak inputs into confident-looking output. Do: show the top bid as yours when the estimate was typed. Don't: show it as printed because the opening bid was.
6. **Say why it is missing, using fixed words.** "Not in the notice" is the default. Use "Set at the sale" or "Not checked yet" only when the source's rules prove it. Why: a wrong reason is invented data. Do: use the default. Don't: write a friendlier custom reason.
7. **Never colour alone.** Material is carried by hatch, text and screen-reader text as well as colour. Why: colour-blind users, forced-colours mode, and print. Do: keep the hatch and the words. Don't: drop them for a cleaner look.

## 3. The three materials

| Material | Meaning | Look | Markup |
| --- | --- | --- | --- |
| Printed | Published by the source | Plain ink, no decoration | `.ev-printed`, `data-evidence="printed"` |
| Yours | Typed by the buyer | Indigo, dashed "pencil" underline, sr-only "Your estimate:" | `.ev-yours`, `data-evidence="yours"` |
| Unknown | Nobody has published it | Amber hatch on a wash, inset hairline, sr-only "Unknown:" | `.ev-unknown`, `data-evidence="unknown"` |

Tokens: `--color-ink`, `--color-yours`, `--color-yours-wash`, `--color-catch`, `--color-catch-ink`, `--color-catch-wash`. Under `forced-colors: active` the hatch is replaced by a dashed `CanvasText` border.

Reasons (type `UnknownReason`): "Not in the notice" (default), "Set at the sale", "Not checked yet".

Weakest-link rule, in short: all inputs printed gives printed; any input yours gives yours; any required input missing gives unknown.

## 4. Colour grammar

| Colour | Token | Use | Never |
| --- | --- | --- | --- |
| Ink family | `ink`, `ink-2`, `ink-3` | Text. `ink-3` is the lightest allowed for text (AA on paper). | Anything lighter for text |
| Paper, card, line | `paper`, `card`, `line`, `line-strong` | Page, raised surface, hairlines | Decorative tints |
| Amber | `catch`, `catch-ink`, `catch-wash` | The catch and unknown values | Warnings unrelated to a missing fact |
| Indigo | `yours`, `yours-wash` | Values the buyer typed | Links or decoration |
| Green | `go`, `go-wash` | Actions and "live" | "Good deal", "verified", "safe" |

## 5. Scale

- **Type, six steps:** `text-display`, `text-title`, `text-lead`, `text-body`, `text-meta`, `text-label` (uppercase, tracked). Display and title are fluid.
- **Shape, three radii:** control 12px (`rounded-control`), card 24px (`rounded-card`), `rounded-full` for chips. The small inline unknown patch is the one exception and lives inside `.ev-unknown`.
- **Space:** Tailwind's default 4px scale. Page gutters `px-5` (`lg:px-8`); cards padded `p-5 sm:p-6`.
- **Motion:** one purposeful animation per moment (for example the catch items settling in, `.catch-item`). All of it is off under `prefers-reduced-motion`.

## 6. Components

- **`Fact`** (`src/components/evidence/fact.tsx`): `<Fact value={...} format="money|date|text" origin="printed|yours" reason="..." />`. Decides the material from the value. Empty, zero money, "n/a", "unknown" and similar all become unknown.
- **`YoursTag`**: a small "yours" chip beside buyer-typed inputs and results.
- **`GapLedger`** (`gap-ledger.tsx`): "What this listing can't tell you". Rows come only from fields that are actually empty, in a fixed house-rule order: occupancy, liens, deposit, redemption, opening bid, sale date (not a cost estimate). Each row has why it matters and a way to find out. It never invents a contact: it links the source notice, or a generic action. Ticks are stored on this device only.
- **`SectionHeading`** (`src/components/site/section-heading.tsx`): the one pattern for section titles: eyebrow pill, headline, one short paragraph. `tone="catch"` for amber sections.
- **`CatchReveal`** (`src/components/site/catch-reveal.tsx`): the homepage proof moment. Fetches a real current listing, shows it the way a sale posts it (price first), then the catch our rules found. Real data only; if listings cannot load it says so.

## 7. Accessibility

- Material is never colour-only: hatch plus text plus sr-only prefix.
- Forced-colours fallback exists for unknown and yours.
- `ink-3` and darker meet AA on paper. Do not use lighter text.
- One `h1` per page, headings in order. `GapLedger` and `SectionHeading` render an `h2`, so put sub-items at `h3`.
- Checkbox rows in `GapLedger` are real buttons with `role="checkbox"` and a label naming the fact.
- Reduced motion turns every animation off.

## 8. Recipe: add a new value to a page

1. Get the raw value from the listing. Do not format it, and do not substitute a fallback string.
2. Render it with `<Fact value={raw} format="..." />`. Add `origin="yours"` only if the buyer typed it, and put a `YoursTag` beside the input.
3. Leave `reason` alone unless the source's own rules prove another one.
4. If it is computed from other values, apply the weakest-link rule to pick the origin.
5. If the field matters to a buyer's decision, add it to `findGaps` in `src/lib/evidence.ts` at its place in the priority order, with why it matters and a way to find out, and extend `test/evidence.test.mjs`.
6. Compare against `/design`: no dash, no collapsed row, no green for approval.
