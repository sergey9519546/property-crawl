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
import { getMessages } from "@/lib/i18n/messages";
import { getRequestLocale } from "@/lib/i18n/server";
import { interpolate } from "@/lib/i18n/translator";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const meta = getMessages(locale).metaExtra;
  return {
    title: meta.designTitle,
    description: meta.designDesc,
    robots: { index: false, follow: false },
  };
}

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

export default async function DesignPage() {
  const locale = await getRequestLocale();
  const t = getMessages(locale).designB2;

  const inkSwatches = [
    ["ink", "bg-ink", t.inkDescHeadings],
    ["ink-2", "bg-ink-2", t.inkDescBody],
    ["ink-3", "bg-ink-3", t.inkDescMeta],
    ["paper", "bg-paper", t.inkDescPage],
    ["card", "bg-card", t.inkDescSurface],
    ["line", "bg-line", t.inkDescHairlines],
    ["line-strong", "bg-line-strong", t.inkDescInputs],
  ] as const;

  const evidenceSwatches = [
    ["catch-wash", "bg-[var(--color-catch-wash)]", t.evDescCatchWash],
    ["catch", "bg-[var(--color-catch)]", t.evDescCatch],
    ["catch-ink", "bg-[var(--color-catch-ink)]", t.evDescCatchInk],
    ["yours", "bg-[var(--color-yours)]", t.evDescYours],
    ["yours-wash", "bg-[var(--color-yours-wash)]", t.evDescYoursWash],
    ["go", "bg-[var(--color-go)]", t.evDescGo],
    ["go-fill", "bg-[var(--color-go-fill)]", t.evDescGoFill],
    ["signature", "bg-[var(--color-signature)]", t.evDescSignature],
  ] as const;

  const typeSteps = [
    ["display", "text-display font-semibold", t.typeDisplay],
    ["title", "text-title font-semibold", t.typeTitle],
    ["lead", "text-lead", t.typeLead],
    ["body", "text-body", t.typeBody],
    ["meta", "text-meta text-ink-2", t.typeMeta],
    ["label", "text-label font-semibold uppercase text-ink-3", t.typeLabel],
  ] as const;

  const radiiSteps = [
    [t.radControl, "rounded-control h-16 w-28"],
    [t.radCard, "rounded-card h-24 w-40"],
    [t.radFull, "rounded-full h-10 w-28"],
  ] as const;

  const elevationSteps = [
    ["shadow-card", t.elevResting],
    ["shadow-raised", t.elevRaised],
    ["shadow-overlay", t.elevOverlay],
  ] as const;

  // A buyer's own model: every bar is "yours", told apart by strength, not hue.
  const modelBars = [
    [t.barAssumed, "bg-yours", "100%"],
    [t.barRepairs, "bg-yours/70", "22%"],
    [t.barCarryClose, "bg-yours/50", "9%"],
    [t.barProfit, "bg-yours/35", "15%"],
  ] as const;

  const bandCopy: Record<string, { label: string; desc: string }> = {
    elite: { label: t.bandEliteLabel, desc: t.bandEliteDesc },
    strong: { label: t.bandStrongLabel, desc: t.bandStrongDesc },
    fair: { label: t.bandFairLabel, desc: t.bandFairDesc },
    thin: { label: t.bandThinLabel, desc: t.bandThinDesc },
  };

  return (
    <div className="min-h-screen bg-paper text-ink">
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="outline-none">
      <div className="mx-auto max-w-[1040px] space-y-16 px-5 pb-24 pt-28 lg:px-8">
        <header>
          <p className={kicker}>{t.kicker}</p>
          <h1 className="mt-3 text-display font-semibold text-ink">{t.title}</h1>
          <p className="mt-4 max-w-[640px] text-lead text-ink-2">
            {t.lead}
          </p>
        </header>

        <section>
          <SectionHeading eyebrow={t.scaleEyebrow} title={t.scaleTitle} align="left" />
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h3 className={kicker}>{t.inkCardTitle}</h3>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {inkSwatches.map(([n, c, u]) => <Swatch key={n} name={n} cls={c} use={u} />)}
              </ul>
            </div>
            <div className={card}>
              <h3 className={kicker}>{t.evidenceCardTitle}</h3>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {evidenceSwatches.map(([n, c, u]) => <Swatch key={n} name={n} cls={c} use={u} />)}
              </ul>
            </div>
            <div className={`${card} md:col-span-2`}>
              <h3 className={kicker}>{t.typeCardTitle}</h3>
              <ul className="mt-4 divide-y divide-line">
                {typeSteps.map(([n, c, s]) => (
                  <li key={n} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 py-3">
                    <code className="w-20 shrink-0 text-meta text-ink-3">{n}</code>
                    <span className={c}>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className={`${card} md:col-span-2`}>
              <h3 className={kicker}>{t.radiiCardTitle}</h3>
              <div className="mt-4 flex flex-wrap items-end gap-6">
                {radiiSteps.map(([n, c]) => (
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
          <SectionHeading eyebrow={t.materialsEyebrow} title={t.materialsTitle} align="left" tone="catch">
            {t.materialsLead}
          </SectionHeading>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className={card}>
              <h3 className={kicker}>{t.matPrintedTitle}</h3>
              <p className="mt-3 text-title font-semibold"><Fact value={t.matPrintedVal} /></p>
              <p className="mt-2 text-meta text-ink-2">{t.matPrintedDesc}</p>
            </div>
            <div className={card}>
              <h3 className={kicker}>{t.matYoursTitle} <YoursTag /></h3>
              <p className="mt-3 text-title font-semibold"><Fact value={t.matYoursVal} origin="yours" /></p>
              <p className="mt-2 text-meta text-ink-2">{t.matYoursDesc}</p>
            </div>
            <div className={card}>
              <h3 className={kicker}>{t.matUnknownTitle}</h3>
              <p className="mt-3 text-title font-semibold"><Fact value={null} format="money" /></p>
              <p className="mt-2 text-meta text-ink-2">{t.matUnknownDesc}</p>
            </div>
          </div>
          <div className={`${card} mt-4`}>
            <h3 className={kicker}>{t.threeReasonsTitle}</h3>
            <ul className="mt-4 grid gap-4 sm:grid-cols-3">
              <li>
                <p className="text-body font-semibold"><Fact value={null} /></p>
                <p className="mt-2 text-meta text-ink-2">{t.reasonDefaultDesc}</p>
              </li>
              <li>
                <p className="text-body font-semibold"><Fact value={null} reason="Set at the sale" /></p>
                <p className="mt-2 text-meta text-ink-2">{t.reasonSaleDayDesc}</p>
              </li>
              <li>
                <p className="text-body font-semibold"><Fact value={null} reason="Not checked yet" /></p>
                <p className="mt-2 text-meta text-ink-2">{t.reasonNotCheckedDesc}</p>
              </li>
            </ul>
          </div>
        </section>

        <section>
          <SectionHeading eyebrow={t.compEyebrow} title={t.compTitle} align="left" tone="catch">
            {t.compLead}
          </SectionHeading>
          <div className="mt-8">
            <GapLedger listing={{ id: "specimen" }} />
          </div>
        </section>

        <section>
          <SectionHeading eyebrow={t.primEyebrow} title={t.primTitle} align="left">
            {t.primLeadBefore} <code>src/components/ui</code> {t.primLeadAfter}
          </SectionHeading>
          <div className="mt-8 grid gap-4">
            <div className={card}>
              <h3 className={kicker}>{t.btnSectionTitle}</h3>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button>{t.btnPrimary}</Button>
                <Button variant="secondary">{t.btnSecondary}</Button>
                <Button variant="outline">{t.btnOutline}</Button>
                <Button variant="ghost">{t.btnGhost}</Button>
                <Button variant="go">{t.btnGo}</Button>
                <Button variant="destructive">{t.btnDestructive}</Button>
                <Button variant="link">{t.btnLink}</Button>
              </div>
              <p className="mt-3 text-meta text-ink-3">{t.btnGuidance}</p>
            </div>
            <div className={card}>
              <h3 className={kicker}>{t.chipsSectionTitle}</h3>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge variant="catch">{t.chipStale}</Badge>
                <Badge variant="catch">{t.chipNotChecked}</Badge>
                <Badge variant="go">{t.chipSaleOpen}</Badge>
                <Badge variant="yours">{t.chipYourEstimate}</Badge>
                <Badge variant="neutral">{t.chipTaxSale}</Badge>
                <Badge variant="neutral">{t.chipThreeSources}</Badge>
              </div>
              <p className="mt-3 text-meta text-ink-3">{t.chipsGuidance}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Alert variant="catch">
                <AlertTriangle aria-hidden />
                <AlertTitle>{t.alertCatchTitle}</AlertTitle>
                <AlertDescription>{t.alertCatchDesc}</AlertDescription>
              </Alert>
              <Alert variant="go">
                <CheckCircle2 aria-hidden />
                <AlertTitle>{t.alertGoTitle}</AlertTitle>
                <AlertDescription>{t.alertGoDesc}</AlertDescription>
              </Alert>
              <Alert variant="neutral">
                <Info aria-hidden />
                <AlertTitle>{t.alertNeutralTitle}</AlertTitle>
                <AlertDescription>{t.alertNeutralDesc}</AlertDescription>
              </Alert>
            </div>
          </div>
        </section>

        <section>
          <SectionHeading eyebrow={t.dataEyebrow} title={t.dataTitle} align="left">
            {t.dataLead}
          </SectionHeading>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h3 className={kicker}>{t.bandsSectionTitle}</h3>
              <ul className="mt-4 space-y-3">
                {SCORE_BANDS.map((band) => {
                  const localized = bandCopy[band.key];
                  return (
                    <li key={band.key} className="flex flex-wrap items-center gap-3">
                      <span className="rounded-full px-3 py-1 text-meta font-bold" style={{ background: `${band.color}${band.alpha}`, color: band.color }}>
                        {interpolate(t.bandRange, { label: localized?.label || band.label, min: band.min, max: band.max })}
                      </span>
                      <span className="text-label text-ink-3">{localized?.desc || band.desc}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className={card}>
              <h3 className={kicker}>{t.buyerModelTitle} <YoursTag /></h3>
              <ul className="mt-4 space-y-3">
                {modelBars.map(([label, fill, width]) => (
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
          <SectionHeading eyebrow={t.surfEyebrow} title={t.surfTitle} align="left" />
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h3 className={kicker}>{t.elevCardTitle}</h3>
              <div className="mt-5 flex flex-wrap gap-5">
                {elevationSteps.map(([cls, use]) => (
                  <div key={cls} className={`w-36 rounded-control bg-card p-4 ${cls}`}>
                    <code className="text-label text-ink">{cls}</code>
                    <p className="mt-1 text-label text-ink-3">{use}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="on-ink rounded-card bg-ink p-5 text-white shadow-overlay sm:p-6">
              <h3 className="text-label font-semibold uppercase text-white/60">{t.onInkTitle}</h3>
              <dl className="mt-4 space-y-3 text-body">
                <div className="flex justify-between gap-4"><dt className="text-white/75">{t.onInkOpening}</dt><dd className="font-semibold"><Fact value={126000} format="money" /></dd></div>
                <div className="flex justify-between gap-4"><dt className="text-white/75">{t.onInkTopBid}</dt><dd className="font-semibold"><Fact value={98000} format="money" origin="yours" /></dd></div>
                <div className="flex justify-between gap-4"><dt className="text-white/75">{t.onInkDeposit}</dt><dd className="font-semibold"><Fact value={null} /></dd></div>
              </dl>
              <p className="mt-4 text-meta text-white/60">{t.onInkGuidancePrefix} <code>on-ink</code> {t.onInkGuidanceSuffix}</p>
            </div>
          </div>
        </section>

        <section>
          <SectionHeading eyebrow={t.statesEyebrow} title={t.statesTitle} align="left" />
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className={card}>
              <h3 className={kicker}>{t.stateLoadingTitle}</h3>
              <div className="mt-4 space-y-2" aria-hidden>
                <Skeleton className="h-5 w-3/4 bg-line" />
                <Skeleton className="h-4 w-1/2 bg-line" />
                <Skeleton className="h-9 w-1/3 bg-line" />
              </div>
              <p className="mt-3 text-meta text-ink-3">{t.stateLoadingDesc}</p>
            </div>
            <div className={card}>
              <h3 className={kicker}>{t.stateEmptyTitle}</h3>
              <p className="mt-4 text-body font-semibold text-ink">{t.stateEmptyHeadline}</p>
              <p className="mt-1 text-meta text-ink-2">{t.stateEmptyDesc}</p>
            </div>
            <Alert variant="catch">
              <AlertTriangle aria-hidden />
              <AlertTitle>{t.stateFailedTitle}</AlertTitle>
              <AlertDescription>{t.stateFailedDesc}</AlertDescription>
            </Alert>
          </div>
        </section>

        <section>
          <SectionHeading eyebrow={t.grammarEyebrow} title={t.grammarTitle} align="left" />
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <div className={card}>
              <h3 className={kicker}>{t.grammarDoTitle}</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-meta text-ink-2">
                <li>{t.doList1}</li>
                <li>{t.doList2}</li>
                <li>{t.doList3}</li>
                <li>{t.doList4}</li>
              </ul>
            </div>
            <div className={card}>
              <h3 className={kicker}>{t.grammarDontTitle}</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-meta text-ink-2">
                <li>{t.dontList1}</li>
                <li>{t.dontList2}</li>
                <li>{t.dontList3}</li>
                <li>{t.dontList4}</li>
              </ul>
            </div>
          </div>
        </section>
      </div>

      </main>
      <SiteFooter />
    </div>
  );
}
