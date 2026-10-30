import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { SectionHeading } from "@/components/site/section-heading";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Fact, YoursTag } from "@/components/evidence/fact";
import { GapLedger } from "@/components/evidence/gap-ledger";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SCORE_BANDS } from "@/lib/score-bands";

export const metadata: Metadata = {
  title: "Design system — PerfectProperty",
  description: "Evidence ink: how PerfectProperty draws printed, yours and unknown values.",
  robots: { index: false, follow: false },
};

const INK = [
  ["ink", "bg-ink", "Headings, values"],
  ["ink-2", "bg-ink-2", "Body copy"],
  ["ink-3", "bg-ink-3", "Meta text (lightest allowed)"],
  ["paper", "bg-paper", "Page"],
  ["card", "bg-card", "Raised surface"],
  ["line", "bg-line", "Hairlines"],
  ["line-strong", "bg-line-strong", "Inputs, checkboxes"],
] as const;

const EVIDENCE = [
  ["catch-wash", "bg-[var(--color-catch-wash)]", "The catch / unknown"],
  ["catch", "bg-[var(--color-catch)]", "Persimmon #FF5533, fills only"],
  ["catch-ink", "bg-[var(--color-catch-ink)]", "Catch text #A92E14"],
  ["yours", "bg-[var(--color-yours)]", "Buyer-typed"],
  ["yours-wash", "bg-[var(--color-yours-wash)]", "Yours chip"],
  ["go", "bg-[var(--color-go)]", "Go text #0B7A56"],
  ["go-fill", "bg-[var(--color-go-fill)]", "Celadon #12B981, action fills"],
  ["signature", "bg-[var(--color-signature)]", "Butter #FFE24A, brand only, never data"],
] as const;

const TYPE = [
  ["display", "text-display font-semibold", "Display"],
  ["title", "text-title font-semibold", "Title"],
  ["lead", "text-lead", "Lead paragraph"],
  ["body", "text-body", "Body text"],
  ["meta", "text-meta text-ink-2", "Meta text"],
  ["label", "text-label font-semibold uppercase text-ink-3", "Label"],
] as const;

const RADII = [
  ["control · 12px", "rounded-control h-16 w-28"],
  ["card · 24px", "rounded-card h-24 w-40"],
  ["full · chips", "rounded-full h-10 w-28"],
] as const;

const ELEVATION = [
  ["shadow-card", "Resting cards"],
  ["shadow-raised", "Featured card, menus"],
  ["shadow-overlay", "Drawers, dialogs"],
] as const;

// A buyer's own model: every bar is "yours", told apart by strength, not hue.
const MODEL_BARS = [
  ["Assumed value", "bg-yours", "100%"],
  ["Repairs", "bg-yours/70", "22%"],
  ["Carry + close", "bg-yours/50", "9%"],
  ["Required profit", "bg-yours/35", "15%"],
] as const;

const card = "rounded-card border border-line bg-card p-5 sm:p-6";
const kicker = "text-label font-semibold uppercase text-ink-3";

function Swatch({ name, cls, use }: { name: string; cls: string; use: string }) {
  return (
    <li className="flex items-center gap-3">
      <span aria-hidden className={`h-10 w-10 shrink-0 rounded-control border border-line ${cls}`} />
      <span>
        <span className="block text-meta font-semibold text-ink">{name}</span>
        <span className="block text-label text-ink-3">{use}</span>
      </span>
    </li>
  );
}

export default function DesignPage() {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <SiteHeader />
      <div className="mx-auto max-w-[1040px] space-y-16 px-5 pb-24 pt-28 lg:px-8">
        <header>
          <p className={kicker}>Design system</p>
          <h1 className="mt-3 text-display font-semibold text-ink">Evidence ink</h1>
          <p className="mt-4 max-w-[640px] text-lead text-ink-2">
            Every value on PerfectProperty is one of three materials: printed, yours, or unknown. A missing fact is
            drawn, never hidden, because empty space reads as safe.
          </p>
        </header>

        <section>
          <SectionHeading eyebrow="Scale" title="One ink family, three radii, six type steps." align="left" />
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h3 className={kicker}>Ink, paper and lines</h3>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {INK.map(([n, c, u]) => <Swatch key={n} name={n} cls={c} use={u} />)}
              </ul>
            </div>
            <div className={card}>
              <h3 className={kicker}>Evidence colours</h3>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {EVIDENCE.map(([n, c, u]) => <Swatch key={n} name={n} cls={c} use={u} />)}
              </ul>
            </div>
            <div className={`${card} md:col-span-2`}>
              <h3 className={kicker}>Type steps</h3>
              <ul className="mt-4 divide-y divide-line">
                {TYPE.map(([n, c, s]) => (
                  <li key={n} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 py-3">
                    <code className="w-20 shrink-0 text-meta text-ink-3">{n}</code>
                    <span className={c}>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className={`${card} md:col-span-2`}>
              <h3 className={kicker}>Radii</h3>
              <div className="mt-4 flex flex-wrap items-end gap-6">
                {RADII.map(([n, c]) => (
                  <div key={n}>
                    <div aria-hidden className={`border border-line-strong bg-paper ${c}`} />
                    <p className="mt-2 text-meta text-ink-2">{n}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section>
          <SectionHeading eyebrow="Materials" title="Three kinds of value, side by side." align="left" tone="catch">
            Same footprint, same size. Only the material changes, and it never relies on colour alone.
          </SectionHeading>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className={card}>
              <h3 className={kicker}>Printed</h3>
              <p className="mt-3 text-title font-semibold"><Fact value="As published" /></p>
              <p className="mt-2 text-meta text-ink-2">Published by the source. Plain ink.</p>
            </div>
            <div className={card}>
              <h3 className={kicker}>Yours <YoursTag /></h3>
              <p className="mt-3 text-title font-semibold"><Fact value="Your number" origin="yours" /></p>
              <p className="mt-2 text-meta text-ink-2">Typed by the buyer. Periwinkle pencil.</p>
            </div>
            <div className={card}>
              <h3 className={kicker}>Unknown</h3>
              <p className="mt-3 text-title font-semibold"><Fact value={null} format="money" /></p>
              <p className="mt-2 text-meta text-ink-2">Nobody published it. Persimmon hatch.</p>
            </div>
          </div>
          <div className={`${card} mt-4`}>
            <h3 className={kicker}>The three reasons</h3>
            <ul className="mt-4 grid gap-4 sm:grid-cols-3">
              <li>
                <p className="text-body font-semibold"><Fact value={null} /></p>
                <p className="mt-2 text-meta text-ink-2">The default. The notice does not say.</p>
              </li>
              <li>
                <p className="text-body font-semibold"><Fact value={null} reason="Set at the sale" /></p>
                <p className="mt-2 text-meta text-ink-2">Only when the source&apos;s rules prove it is set on sale day.</p>
              </li>
              <li>
                <p className="text-body font-semibold"><Fact value={null} reason="Not checked yet" /></p>
                <p className="mt-2 text-meta text-ink-2">Only when it is knowable but we have not looked.</p>
              </li>
            </ul>
          </div>
        </section>

        <section>
          <SectionHeading eyebrow="Component" title="A specimen with empty fields." align="left" tone="catch">
            This ledger is a demo object with every field empty, so every gap shows. It is not a property and holds no
            real data.
          </SectionHeading>
          <div className="mt-8">
            <GapLedger listing={{ id: "specimen" }} />
          </div>
        </section>

        <section>
          <SectionHeading eyebrow="Primitives" title="Buttons, chips and notices, picked by meaning." align="left">
            The shadcn kit in <code>src/components/ui</code> is themed onto the palette, plus evidence variants. Reach
            for these before hand-writing classes.
          </SectionHeading>
          <div className="mt-8 grid gap-4">
            <div className={card}>
              <h3 className={kicker}>Buttons</h3>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button>Primary · ink</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="go">Live action · go</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="link">Link</Button>
              </div>
              <p className="mt-3 text-meta text-ink-3">One ink primary per view. Go only for live actions such as opening a sale or running a hunt.</p>
            </div>
            <div className={card}>
              <h3 className={kicker}>Chips</h3>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge variant="catch">Stale source</Badge>
                <Badge variant="catch">Not checked yet</Badge>
                <Badge variant="go">Sale open</Badge>
                <Badge variant="yours">Your estimate</Badge>
                <Badge variant="neutral">Tax sale</Badge>
                <Badge variant="neutral">3 sources</Badge>
              </div>
              <p className="mt-3 text-meta text-ink-3">Sale types and counts are published facts, so they stay neutral. Never a green &ldquo;verified&rdquo; chip.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Alert variant="catch">
                <AlertTriangle aria-hidden />
                <AlertTitle>Occupied · no interior access</AlertTitle>
                <AlertDescription>The listing&apos;s own catch, or an error. Persimmon.</AlertDescription>
              </Alert>
              <Alert variant="go">
                <CheckCircle2 aria-hidden />
                <AlertTitle>Hunt saved</AlertTitle>
                <AlertDescription>The user&apos;s own action worked. Green.</AlertDescription>
              </Alert>
              <Alert variant="neutral">
                <Info aria-hidden />
                <AlertTitle>Listings are updating</AlertTitle>
                <AlertDescription>System or legal notices. Neutral, never persimmon.</AlertDescription>
              </Alert>
            </div>
          </div>
        </section>

        <section>
          <SectionHeading eyebrow="Data" title="Numbers to check, not verdicts." align="left">
            A Deal Score is drawn on an ink ladder, never green or red. A buyer&apos;s model is drawn in periwinkle,
            told apart by strength, not by new hues.
          </SectionHeading>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h3 className={kicker}>Deal Score bands</h3>
              <ul className="mt-4 space-y-3">
                {SCORE_BANDS.map((band) => (
                  <li key={band.key} className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full px-3 py-1 text-meta font-bold" style={{ background: `${band.color}${band.alpha}`, color: band.color }}>
                      {band.label} · {band.min}–{band.max}
                    </span>
                    <span className="text-label text-ink-3">{band.desc}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className={card}>
              <h3 className={kicker}>A buyer&apos;s model <YoursTag /></h3>
              <ul className="mt-4 space-y-3">
                {MODEL_BARS.map(([label, fill, width]) => (
                  <li key={label}>
                    <p className="text-meta text-ink-2">{label}</p>
                    <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-line">
                      <div className={`h-full rounded-full ${fill}`} style={{ width }} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section>
          <SectionHeading eyebrow="Surfaces" title="Elevation and the dark panel." align="left" />
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h3 className={kicker}>Elevation, cast in ink</h3>
              <div className="mt-5 flex flex-wrap gap-5">
                {ELEVATION.map(([cls, use]) => (
                  <div key={cls} className={`w-36 rounded-control bg-card p-4 ${cls}`}>
                    <code className="text-label text-ink">{cls}</code>
                    <p className="mt-1 text-label text-ink-3">{use}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="on-ink rounded-card bg-ink p-5 text-white shadow-overlay sm:p-6">
              <h3 className="text-label font-semibold uppercase text-white/60">Evidence on ink</h3>
              <dl className="mt-4 space-y-3 text-body">
                <div className="flex justify-between gap-4"><dt className="text-white/75">Opening bid</dt><dd className="font-semibold"><Fact value={126000} format="money" /></dd></div>
                <div className="flex justify-between gap-4"><dt className="text-white/75">Your top bid</dt><dd className="font-semibold"><Fact value={98000} format="money" origin="yours" /></dd></div>
                <div className="flex justify-between gap-4"><dt className="text-white/75">Deposit</dt><dd className="font-semibold"><Fact value={null} /></dd></div>
              </dl>
              <p className="mt-4 text-meta text-white/60">Add <code>on-ink</code> to any dark container that renders a Fact. Text steps are white, white/75 and white/60.</p>
            </div>
          </div>
        </section>

        <section>
          <SectionHeading eyebrow="States" title="Loading, empty and failed, each said plainly." align="left" />
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className={card}>
              <h3 className={kicker}>Loading</h3>
              <div className="mt-4 space-y-2" aria-hidden>
                <Skeleton className="h-5 w-3/4 bg-line" />
                <Skeleton className="h-4 w-1/2 bg-line" />
                <Skeleton className="h-9 w-1/3 bg-line" />
              </div>
              <p className="mt-3 text-meta text-ink-3">Reserve the final size so nothing jumps when data lands.</p>
            </div>
            <div className={card}>
              <h3 className={kicker}>Empty</h3>
              <p className="mt-4 text-body font-semibold text-ink">No listings match these filters.</p>
              <p className="mt-1 text-meta text-ink-2">Say what is missing and the next step. Neutral, because nothing went wrong.</p>
            </div>
            <Alert variant="catch">
              <AlertTriangle aria-hidden />
              <AlertTitle>Listings could not load</AlertTitle>
              <AlertDescription>Failed is not empty: say it failed, and offer a retry. Never fall back to sample data.</AlertDescription>
            </Alert>
          </div>
        </section>

        <section>
          <SectionHeading eyebrow="Colour grammar" title="Colour is spent on evidence, not mood." align="left" />
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h3 className={kicker}>Do</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-meta text-ink-2">
                <li>Persimmon for the catch and for unknown values.</li>
                <li>Periwinkle for what the buyer typed.</li>
                <li>Celadon green for an action or for something live.</li>
                <li>Ink, paper and lines for everything else.</li>
              </ul>
            </div>
            <div className={card}>
              <h3 className={kicker}>Don&apos;t</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-meta text-ink-2">
                <li>Use green for &ldquo;good deal&rdquo; or &ldquo;verified&rdquo;. Green reads as safe.</li>
                <li>Show a missing value as a dash or blank space.</li>
                <li>Pass a typed estimate off in plain ink.</li>
                <li>Carry meaning in colour alone.</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
      <SiteFooter />
    </main>
  );
}
