---
name: PerfectProperty
description: Evidence-first discovery and triage layer for distressed and government-sold real estate
colors:
  primary: "#181529"
  neutral-bg: "#f5f6f7"
  card: "#ffffff"
  line: "#e5e7eb"
  line-strong: "#d1d5db"
  catch: "#a92e14"
  catch-wash: "rgba(255, 85, 51, 0.08)"
  yours: "#3651e0"
  yours-wash: "rgba(79, 107, 246, 0.08)"
  go: "#0b7a56"
  go-fill: "#12b981"
  signature: "#ffe24a"
typography:
  display:
    fontFamily: "Inter, sans-serif"
    fontSize: "clamp(2rem, 1.4rem + 2.6vw, 3rem)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, sans-serif"
    fontSize: "clamp(1.5rem, 1.2rem + 1.2vw, 2rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  lead:
    fontFamily: "Inter, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.65
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  meta:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.45
  label:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.1em"
  mono:
    fontFamily: "var(--font-geist-mono), monospace"
    fontSize: "0.875rem"
    fontWeight: 400
rounded:
  control: "12px"
  card: "24px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.card}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
  button-go:
    backgroundColor: "{colors.go}"
    textColor: "{colors.card}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
  card-surface:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.card}"
    padding: "24px"
---

# Design System: PerfectProperty (Evidence Ink)

## Overview

**Creative North Star: "The Forensic Cadastral Dossier"**

PerfectProperty is built on the reality that distressed property acquisition is adversarial, legalistic, and fraught with missing facts. Most consumer real estate interfaces cosmetically sanitize listings with vaporwave gradients and fake price discounts. In Evidence Ink, missing facts are treated with the same weight as published facts: a gap is drawn, never hidden.

The visual language marries high-contrast architectural drafting (cadastral coordinates, hairline plat rules, surveyor crosshairs) with clean, accessible consumer typography. It avoids playful SaaS clichés and refuses to turn green to signal an unvetted deal.

**Key Characteristics:**
- **Evidence-Governed Palette**: Ink, cool paper, and hairline borders dominate 90% of surfaces. Color is strictly reserved for evidence status.
- **Radical Transparency**: Missing fields become explicit persimmon hatch marks, not empty dashes or suppressed rows.
- **Architectural Drafting Hierarchy**: Hairline coordinate dividers (`+`), parcel boundaries, and tabular monospace numerals replace decorative blobs.

## Colors

The palette is derived from legal notice ink, archival survey paper, and warning stamps. Color is never spent on aesthetic mood.

### Primary
- **Midnight Ink** (`#181529`): The authoritative baseline text, primary button fill, and high-contrast structural anchor. Never pure black.

### Evidence Roles
- **Persimmon Catch** (`#a92e14`, wash `rgba(255, 85, 51, 0.08)`): Reserved exclusively for liabilities, missing required terms, unexpired redemption clocks, and active tenant occupancy.
- **Periwinkle Yours** (`#3651e0`, wash `rgba(79, 107, 246, 0.08)`): Represents buyer-supplied assumptions, editable estimates, and form focus rings. Always rendered with a dashed pencil underline in data views.
- **Celadon Green** (`#0b7a56`, fill `#12b981`): Used solely for live user actions, confirmed events, and the "live" auction indicator.

### Signature Accent
- **Sunlit Butter** (`#ffe24a`): Brand moments only (active radio pills, selection indicators). Never applied to data values.

### Neutral
- **Cool Paper** (`#f5f6f7`): The default page background. A cool, archival newsprint tone.
- **Card Surface** (`#ffffff`): The resting background for cards, tables, and modal dialogs.
- **Hairline Line** (`#e5e7eb`, strong `#d1d5db`): 1px borders, subtle cadastral divisions, and table dividers.

### Named Rules
**The Green-Is-Not-Safe Rule.** Green is strictly prohibited from indicating that a listing is a "good deal" or "verified safe." In distressed property, every deal has risk; green is reserved exclusively for interactive actions and confirmed user inputs.

**The Weakest-Link Rule.** Any calculated spread or score is only as strong as its least confident input. If an estimate was buyer-typed, the entire result is styled as "Yours". If an essential statutory variable is omitted, the result is styled as "Unknown".

## Typography

**Display & Body Font:** Inter (`--font-inter`, sans-serif)  
**Monospace / Data Font:** Geist Mono (`--font-geist-mono`, monospace)  
**Editorial Font:** Droid Serif (used strictly for pull-quotes)

### Hierarchy
- **Display** (Semi-bold 600, `clamp(2rem, 1.4rem + 2.6vw, 3rem)`, line-height 1.08, tracking -0.025em): Major section headlines and primary hero value proposition.
- **Title** (Semi-bold 600, `clamp(1.5rem, 1.2rem + 1.2vw, 2rem)`, line-height 1.15, tracking -0.02em): Section headings, card headers, and module titles.
- **Lead** (Regular 400, `1.125rem`, line-height 1.65): Explanatory intro paragraphs and value statements.
- **Body** (Regular 400, `1rem`, line-height 1.6, max measure 65–75ch): General copy, listing descriptions, and legal notices.
- **Meta** (Medium 500, `0.875rem`, line-height 1.45): Secondary facts, table cells, and button labels.
- **Label** (Bold 700, `0.75rem`, line-height 1.2, letter-spacing 0.1em, uppercase): Eyebrows, badge chips, and status labels.
- **Mono** (Regular 400, `0.875rem`): Parcel APNs, case docket numbers, and coordinate citations.

### Named Rules
**The No-Fabricated-Precision Rule.** Hand-sized arbitrary pixel font values (`text-[13px]`) are prohibited; all text styles map to the 6 semantic type steps.

## Layout

- **Page Grid**: Standardized max-width `max-w-7xl` centered with responsive gutter padding `px-5 sm:px-8 lg:px-12`.
- **Rhythm & Cadence**: Structural section dividers are 1px hairlines with architectural coordinates (`SEC 01 // 39°45'N 104°59'W`), avoiding ambient glow or pastel blur.
- **Terminal Layout**: 12-item spotlight grid per view on the marketing surface, expanding on demand with link-out to the complete `/listings` workbench.

## Elevation & Depth

Surfaces are resting flat on paper with subtle ink-tinted shadows. Depth communicates interaction potential and elevation, never cosmetic haloing.

### Shadow Vocabulary
- **Card Shadow** (`shadow-card`): `0 1px 3px 0 rgba(24, 21, 41, 0.06), 0 1px 2px -1px rgba(24, 21, 41, 0.04)` — Default resting cards and modules.
- **Raised Shadow** (`shadow-raised`): `0 10px 25px -5px rgba(24, 21, 41, 0.08), 0 8px 10px -6px rgba(24, 21, 41, 0.04)` — Hovered listing cards and active showcase panels.
- **Overlay Shadow** (`shadow-overlay`): `0 20px 40px -10px rgba(24, 21, 41, 0.18)` — Drawers, modals, and sticky floating capsules.

### Named Rules
**The No-Zero-Blur Rule.** Colored glowing halos with 0px blur or massive ambient diffusion are rejected; all elevation carries positive vertical offset and soft ink dissipation.

## Shapes

- **Control Radius** (`rounded-control`, 12px): All interactive buttons, form inputs, and filter chips.
- **Card Radius** (`rounded-card`, 24px): All content cards, section modules, and floating panels.
- **Pill Radius** (`rounded-full`): Status badges, counter chips, and avatar avatars.

## Components

### Buttons
- `button-primary`: Solid Midnight Ink (`bg-ink text-white rounded-control hover:bg-ink-2`), used for the single primary action per view.
- `button-secondary`: Card background with hairline border (`bg-card border-line text-ink rounded-control hover:bg-paper`).
- `button-go`: Celadon Green (`bg-go text-white rounded-control hover:bg-go-fill`), reserved for live auction bids and alerts enrollment.

### Listing Cards
- Bordered `rounded-card` containers with resting `bg-card` and `shadow-card`.
- Structured header with publisher source badge, verified photo with aspect ratio lock, and statutory triage flags.
- Clear action footer with primary *"Inspect Deal"* CTA and secondary *"Listing page"* link.

## Do's and Don'ts

### Do
- Draw missing data visibly with the persimmon hatch pattern and explicit reason ("Not in the notice").
- Pair statutory warnings (occupancy, redemption, senior lien) with actionable financial mitigation heuristics.
- Keep hairline survey coordinates and plat drafting aesthetics clean and legible.

### Don't
- Never use green for "good deal" or "safe purchase".
- Never hide a missing attribute with a dash or empty cell.
- Never use vaporwave gradients, glowing purple meshes, or luxury architectural glass mansions to market distressed county foreclosures.
- Never bypass the 3-radius shape system (`control: 12px`, `card: 24px`, `full: 9999px`).
