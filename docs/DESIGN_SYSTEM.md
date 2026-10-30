# PerfectProperty design system: evidence ink

Live specimen: `/design` (not indexed). Source of truth for tokens: the `@theme` block and the "Evidence ink" block in `src/app/globals.css`. Rules for missing values: `src/lib/evidence.ts`. Components: `src/components/evidence/`, plus the themed primitives in `src/components/ui/`. Guard: `test/design-tokens.test.mjs`.

## 1. The insight

Auction buyers act on incomplete information, and the facts that are missing matter more than the facts that are shown. Most interfaces draw a missing value as empty space or a dash. A clean-looking listing then quietly reads as a safe one.

Our brand promise is "Every deal has a catch. We show it first." The design system exists to keep that promise in pixels: a gap must look like something, as loud as a fact, never quieter.

## 2. Principles

1. **A gap is drawn, not hidden.** A missing value keeps the same footprint as a real one and is never collapsed or dimmed. Why: empty space reads as "nothing to worry about". Do: show "Not in the notice" where the deposit would be. Don't: show a dash, or drop the row.
2. **Every value has an origin, and the origin is visible.** Printed, yours, or unknown. Why: a buyer's guess that looks like a published fact is the most expensive mistake on the page. Do: mark a typed estimate with the pencil style and "yours". Don't: render an estimate in plain ink.
3. **The caller never chooses "unknown".** Unknown is what a missing value becomes. Why: if a developer can pick it, a developer can style it away. Do: pass the raw value to `Fact`. Don't: add an `unknown` prop or pre-format a fallback string.
4. **Colour is spent on evidence, not mood.** Persimmon means the catch, periwinkle means yours, celadon green means an action or "live". Sunlit butter is the signature: brand moments only, never data. Everything else is ink, paper and lines. Why: green reads as safe, and nothing here is safe by default. Do: use green for a button. Don't: use green for "good deal" or "verified".
5. **A derived number is only as strong as its weakest input (weakest-link rule).** Built on any guess, it is "yours". With a required input missing, it is unknown. Why: arithmetic launders weak inputs into confident-looking output. Do: show the top bid as yours when the estimate was typed. Don't: show it as printed because the opening bid was.
6. **Say why it is missing, using fixed words.** "Not in the notice" is the default. Use "Set at the sale" or "Not checked yet" only when the source's rules prove it. Why: a wrong reason is invented data. Do: use the default. Don't: write a friendlier custom reason.
7. **Never colour alone.** Material is carried by hatch, text and screen-reader text as well as colour. Why: colour-blind users, forced-colours mode, and print. Do: keep the hatch and the words. Don't: drop them for a cleaner look.

## 3. The three materials

| Material | Meaning | Look | Markup |
| --- | --- | --- | --- |
| Printed | Published by the source | Plain ink, no decoration | `.ev-printed`, `data-evidence="printed"` |
| Yours | Typed by the buyer | Periwinkle, dashed "pencil" underline, sr-only "Your estimate:" | `.ev-yours`, `data-evidence="yours"` |
| Unknown | Nobody has published it | Persimmon hatch on a wash, inset hairline, sr-only "Unknown:" | `.ev-unknown`, `data-evidence="unknown"` |

Tokens: `--color-ink`, `--color-yours`, `--color-yours-wash`, `--color-catch`, `--color-catch-ink`, `--color-catch-wash`. Under `forced-colors: active` the hatch is replaced by a dashed `CanvasText` border.

Reasons (type `UnknownReason`): "Not in the notice" (default), "Set at the sale", "Not checked yet".

Weakest-link rule, in short: all inputs printed gives printed; any input yours gives yours; any required input missing gives unknown.

## 4. Colour grammar

| Colour | Token | Use | Never |
| --- | --- | --- | --- |
| Ink family | `ink`, `ink-2`, `ink-3` | Text. `ink-3` is the lightest allowed for text (AA on paper). | Anything lighter for text |
| Paper, card, line | `paper`, `card`, `line`, `line-strong` | Page, raised surface, hairlines | Decorative tints |
| Persimmon `#FF5533` (text: `#A92E14`) | `catch`, `catch-ink`, `catch-wash` | The catch and unknown values | Warnings unrelated to a missing fact |
| Periwinkle `#4F6BF6` (text: `#3651E0`) | `yours`, `yours-wash` | Values the buyer typed | Links or decoration |
| Celadon `#12B981` (text: `#0B7A56`) | `go`, `go-fill`, `go-wash` | Actions and "live". On `go-fill` use ink text: white is 2.5:1. | "Good deal", "verified", "safe" |
| Sunlit butter `#FFE24A` | `signature` | Brand moments: selection, eyebrow dots | Any data value |

**Cases the table doesn't settle:**
- **Deal Score bands** are an ink ladder (Elite `ink`, Strong `ink-2`, Fair and Thin `ink-3`), set once in `src/lib/score-bands.ts` and mirrored in `server/intelligence/score-bands.js`. A score is a number to check, not a verdict, so it never turns green or red.
- **System notices** (database unavailable, data mode, legal notices) are neutral: `border-line-strong bg-paper text-ink-2`. Persimmon is reserved for the listing's own catch.
- **Errors** (a failed form or a failed load) borrow the catch tokens. Something is wrong or missing, which is what persimmon means.
- **Success** of the user's own action, like a sent form, uses `go`: `bg-go-wash`, and a solid `bg-go` with white text for buttons.
- **Form fields** focus in periwinkle: a field is where the buyer writes.
- **Published data** (counts, dates, sources, opening bids, citations) is always ink, never periwinkle or green.

## 5. Surfaces and dark panels

- **Neutrals are cool.** Page `paper` (#F5F6F7), raised `card` (white), hairlines `line` (#E5E7EB), stronger dividers and input borders `line-strong` (#D1D5DB). They are deliberately quiet so the four evidence colours carry all the meaning.
- **Dark panels** are `bg-ink` with white text in three steps: `text-white`, `text-white/75`, `text-white/60`. Never slate greys on ink.
- **Evidence on ink:** add `on-ink` to the dark container. It switches `Fact` to the dark-surface tones: yours becomes `#A9B8FF` with a 2px pencil line, unknown becomes `#FFB59F` on a persimmon hatch. Both pass AA on ink.
- **Green and persimmon on ink:** text-safe green on ink is `go-fill` (not `go`, which is 3:1 there). Persimmon text on ink uses `text-catch` (5.6:1) or the `#FFB59F` tone; its wash becomes `bg-catch/10`.

## 6. Scale

- **Type, six steps:** `text-display`, `text-title`, `text-lead`, `text-body`, `text-meta`, `text-label` (uppercase, tracked). Display and title are fluid. Hand-sized `text-[13px]` is debt (see section 12).
- **Shape, three radii:** control 12px (`rounded-control`, also shadcn's `rounded-lg`), card 24px (`rounded-card`), `rounded-full` for chips. The small inline unknown patch is the one exception and lives inside `.ev-unknown`.
- **Elevation, three levels, all cast in ink, never pure black:** `shadow-card` for resting cards, `shadow-raised` for a featured card or a menu, `shadow-overlay` for drawers, dialogs and dark panels.
- **Space:** Tailwind's default 4px scale. Page gutters `px-5` (`lg:px-8`); cards padded `p-5 sm:p-6`.
- **Motion:** tokens live in `:root`: `--ease-out` and `--ease-in-out`, plus `--duration-press` (120ms), `--duration-hover` (150ms), `--duration-state` (180ms), `--duration-camera` (500ms) and `--duration-market-scan` (1s). One purposeful animation per moment (for example the catch items settling in, `.catch-item`). All of it is off under `prefers-reduced-motion`.

## 7. Evidence components

- **`Fact`** (`src/components/evidence/fact.tsx`): `<Fact value={...} format="money|date|text" origin="printed|yours" reason="..." />`. It decides the material from the value. Empty values, zero money, "n/a", "unknown", "TBD" and similar all become unknown. A buyer's own result of $0 stays $0.
- **`YoursTag`**: a small "yours" chip beside buyer-typed inputs and results.
- **`GapLedger`** (`gap-ledger.tsx`): "What this listing can't tell you". Rows come only from fields that are actually empty, in a fixed house-rule order: occupancy, liens, deposit, redemption, opening bid, sale date. That order is not a cost estimate. Modeled values (a state-table redemption baseline, a pattern-matched lien signal) do not close a gap. Each row says why it matters and how to find out. It never invents a contact: it links the source notice or a generic action. Ticks are stored on this device only.
- **`SectionHeading`** (`src/components/site/section-heading.tsx`): the one pattern for section titles: eyebrow pill, headline, one short paragraph. `tone="catch"` for persimmon (catch) sections.
- **`CatchReveal`** (`src/components/site/catch-reveal.tsx`): the homepage proof moment. It fetches a real current listing, shows it the way a sale posts it (price first), then the catch our rules found. It uses real data only; if listings cannot load, it says so.

## 8. Primitives

The shadcn kit in `src/components/ui` is themed onto the palette through its CSS variables in `globals.css`: primary is ink, destructive is catch-ink, ring is periwinkle, and card, muted and accent are the neutrals. Every primitive (dialog, sheet, select, tabs, tooltip and the rest) therefore already speaks the system. Reach for these before hand-writing classes.

| Primitive | Variants | Pick by meaning |
| --- | --- | --- |
| `Button` | `default` (ink), `secondary`, `outline`, `ghost`, `link`, `destructive`, `go` | One ink primary per view. `go` only for live actions, such as opening a sale or running a hunt. `destructive` for deleting the user's own things. |
| `Badge` (chips) | `catch`, `go`, `yours`, `neutral`, plus shadcn's `default`, `secondary`, `outline` | `catch` for stale, unverified or unknown. `go` for live or the user's own action done. `yours` for typed values. `neutral` for published facts, sale types and counts. |
| `Alert` (notices) | `catch`, `go`, `neutral`, plus `default`, `destructive` | `catch` for the listing's own risk or an error. `go` for success of the user's action. `neutral` for system and legal notices. |

- **Notices and screen readers:** a static notice is page content, so `Alert` sets no live role. Only `destructive` gets `role="alert"`. When a notice appears in response to an action, pass `role="status"` (success) or `role="alert"` (failure).
- **Forms:** fields use `border-line-strong bg-card` and focus in periwinkle globally, so don't add per-field focus colours. Errors sit under the field in `text-catch-ink`. Required marks are `text-catch-ink`.

## 9. States

| State | Look | Rule |
| --- | --- | --- |
| Loading | `Skeleton` in `bg-line`, at the final size | Reserve the space so nothing jumps when data lands (guarded by `test/cls-reserved-space.test.mjs`). |
| Empty | Neutral text: what is missing, then the next step | Nothing went wrong, so no persimmon. |
| Failed | `Alert variant="catch"` with a retry | Failed is not empty. Never fall back to sample or demo data. |
| Stale or unverified | `Badge variant="catch"` ("Stale", "Unverified") | The record may be wrong, which is a catch. |
| Pending (a check the buyer hasn't done) | Neutral | Absence of a risk signal is not verification. Only the buyer marks a check done, and done is `go`. |

## 10. Data display

- **Deal Score** is an ink ladder: Elite `ink`, Strong `ink-2`, Fair and Thin `ink-3`. It is set once in `src/lib/score-bands.ts` and mirrored in `server/intelligence/score-bands.js`. Always render it through `bandForScore()`, never a hard-coded colour.
- **A buyer's model** (calculator bars, sliders, results) is all periwinkle, told apart by strength (`bg-yours`, `/70`, `/50`, `/35`), never by new hues. Results follow the weakest-link rule, so they are yours too.
- **Published comparisons** (price drops, bid spreads, counts, comps) are ink. A drop in an opening bid is a fact, not good news, so it gets no green arrow.
- **Charts** use `--chart-1..5`: ink, periwinkle, ink-3, persimmon, celadon. Keep their meanings: persimmon only for risk, periwinkle only for buyer input.

## 11. Evidence voice (copy rules)

Evidence ink is also how we write. These rules came out of the audit that went with the palette rollout.

1. **Plain sentences, not shouted labels.** Write "No federal tax lien is mentioned in the notice", not "NO IRS NOTICE PHRASE:".
2. **No signal is not a check.** Don't write "verified", "clear" or "confirmed" unless a person or the source verified it. Write what was looked at and what wasn't.
3. **Modeled is not printed.** A state-table rule or a pattern match is labelled as a rule ("NM redemption rule: up to 270 days"), never presented as this sale's term.
4. **Say what is actually missing.** "Needs an opening bid" beats "Not entered" when the buyer can't enter it.
5. **Counts are live or absent.** A number on the page comes from the API or isn't shown. No hand-typed totals, no "every listing" claims the data can't back.
6. **Never promise a feature the code doesn't have.** If price drops show in the portfolio but aren't emailed, say "in your portfolio".

## 12. Governance

`test/design-tokens.test.mjs` runs in `npm run test:meta-guards` and fails the build when:

- buyer-facing code uses a raw Tailwind hue (`bg-slate-100`, `text-emerald-700`, ...) or an old slate hex;
- a surface uses solid `bg-white` instead of `bg-card`;
- white text sits on `go-fill` (2.5:1);
- hand-sized type (`text-[Npx]`) or radii (`rounded-[Npx]`) grow past their recorded baselines. Lower the baselines when you pay the debt down; never raise them;
- the shadcn variables drift off the palette, or `--card` stops matching `--color-card` (the bug that once made every card pure white).

Each rule has a control check, so the guard can't pass by matching nothing. The legacy list in that test names what is out of scope on purpose: the shadcn source, the hero and its map, and the staff-only tools (research, sources, document review, activity, workspace settings).

**Add a token:** define it in `@theme` in `globals.css`. If shadcn has a matching variable, map it too. Show it on `/design` and add it to the table in section 4 or 6. If it can be misused, add a rule to the guard.

**Known debt:** hand-sized type and radii, tracked by the ratchet; the staff tools; the hero and its map; and per-source badge colours in `src/components/terminal/property-data.ts`, which are shared with the map markers and the database seed.

## 13. Accessibility

- Material is never colour-only: hatch plus text plus an sr-only prefix.
- A forced-colours fallback exists for unknown and yours.
- `ink-3` and darker meet AA on paper and card. Don't use lighter text.
- One `h1` per page, with headings in order. `GapLedger` and `SectionHeading` render an `h2`, so put sub-items at `h3`.
- Checkbox rows in `GapLedger` are real buttons with `role="checkbox"` and a label naming the fact.
- Static notices don't interrupt screen readers; live results announce with `status` or `alert` (section 8).
- Reduced motion turns every animation off.

## 14. Recipe: add a new value to a page

1. Get the raw value from the listing. Don't format it, and don't substitute a fallback string.
2. Render it with `<Fact value={raw} format="..." />`. Add `origin="yours"` only if the buyer typed it, and put a `YoursTag` beside the input.
3. Leave `reason` alone unless the source's own rules prove another one.
4. If it is computed from other values, apply the weakest-link rule to pick the origin.
5. If the field matters to a buyer's decision, add it to `findGaps` in `src/lib/evidence.ts` at its place in the priority order, with why it matters and how to find out, and extend `test/evidence.test.mjs`.
6. Compare against `/design`: no dash, no collapsed row, no green for approval, no shouted labels.
