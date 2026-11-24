"use client";

import * as React from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { useLocale } from "@/components/i18n/locale-provider";
import type { Locale } from "@/lib/i18n/config";

type EnrichResponse = {
  analysis?: string | null;
  aiNarrative?: string | null;
  cached?: boolean;
  model?: string | null;
  costUsd?: number;
  verified?: boolean;
};

type Labels = {
  eyebrow: string;
  observedTitle: string;
  unverifiedNotice: string;
  unverifiedDetail: string;
  loading: string;
  unavailable: string;
  deterministicBadge: string;
  cachedZeroCostBadge: string;
  inspectEvidenceShow: string;
  inspectEvidenceHide: string;
  noBriefingFallbackNote: string;
};

const LABELS: Record<Locale, Labels> = {
  en: {
    eyebrow: "AI Operator Briefing",
    observedTitle: "Observed Evidence Summary",
    unverifiedNotice: "Unverified summary of stored fields",
    unverifiedDetail:
      "Reports stored record fields only. Not a title search, appraisal, legal opinion, condition report, or bidding recommendation.",
    loading: "Loading cached operator briefing…",
    unavailable:
      "Cached operator briefing is currently unavailable. Review the stored record fields below.",
    deterministicBadge: "Deterministic",
    cachedZeroCostBadge: "Cached $0",
    inspectEvidenceShow: "Inspect Observed Evidence Summary",
    inspectEvidenceHide: "Hide Observed Evidence Summary",
    noBriefingFallbackNote:
      "No cached AI briefing yet — showing the deterministic summary of stored fields.",
  },
  hy: {
    eyebrow: "ԱՀ օպերատորի ամփոփագիր",
    observedTitle: "Դիտարկված փաստերի ամփոփագիր",
    unverifiedNotice: "Պահպանված դաշտերի չստուգված ամփոփագիր",
    unverifiedDetail:
      "Ներկայացնում է միայն պահպանված տվյալները։ Սա իրավական եզրակացություն, տիտղոսի ստուգում, գնահատում կամ աճուրդային խորհուրդ չէ։",
    loading: "Բեռնվում է պահպանված օպերատորի ամփոփագիրը…",
    unavailable:
      "Պահպանված ամփոփագիրը ժամանակավորապես անհասանելի է։ Ստուգեք ստորև ներկայացված տվյալները։",
    deterministicBadge: "Դետերմինիստիկ",
    cachedZeroCostBadge: "Քեշ $0",
    inspectEvidenceShow: "Դիտել դիտարկված փաստերի ամփոփագիրը",
    inspectEvidenceHide: "Թաքցնել դիտարկված փաստերի ամփոփագիրը",
    noBriefingFallbackNote:
      "Քեշավորված ԱՀ ամփոփագիր դեռ չկա — ցուցադրվում է միայն պահպանված դաշտերի դետերմինիստիկ ամփոփագիրը։",
  },
  ru: {
    eyebrow: "ИИ-сводка для оператора",
    observedTitle: "Сводка наблюдаемых фактов",
    unverifiedNotice: "Непроверенная сводка сохранённых полей",
    unverifiedDetail:
      "Отражает только сохранённые поля записи. Не является проверкой титула, оценкой, юридическим заключением или рекомендацией по торгам.",
    loading: "Загрузка сохранённой сводки оператора…",
    unavailable:
      "Сохранённая сводка сейчас недоступна. Изучите наблюдаемые поля записи ниже.",
    deterministicBadge: "Детерминированная",
    cachedZeroCostBadge: "Кэш $0",
    inspectEvidenceShow: "Показать сводку наблюдаемых фактов",
    inspectEvidenceHide: "Скрыть сводку наблюдаемых фактов",
    noBriefingFallbackNote:
      "Кэшированной ИИ-сводки пока нет — показана детерминированная сводка только по сохранённым полям.",
  },
};

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function renderBoldSegments(text: string): React.ReactNode {
  const decoded = decodeBasicEntities(text);
  const parts = decoded.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function StructuredSummaryText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (keyPrefix: string) => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={keyPrefix} className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink-2">
        {listItems.map((item, idx) => (
          <li key={idx}>{renderBoldSegments(item)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushList(`list-${index}`);
      return;
    }
    if (line.startsWith("- ")) {
      listItems.push(line.slice(2).trim());
      return;
    }
    flushList(`list-before-${index}`);
    if (line.startsWith("**") && line.endsWith("**") && line.indexOf("**", 2) === line.length - 2) {
      blocks.push(
        <h3 key={`h-${index}`} className="pt-2 text-xs font-bold uppercase tracking-wider text-ink first:pt-0">
          {decodeBasicEntities(line.slice(2, -2))}
        </h3>,
      );
      return;
    }
    blocks.push(
      <p key={`p-${index}`} className="text-xs leading-relaxed text-ink-2">
        {renderBoldSegments(line)}
      </p>,
    );
  });

  flushList("list-end");
  return <div className="space-y-2">{blocks}</div>;
}

export function AiBriefingCard({ listingId }: { listingId: string }) {
  const { locale } = useLocale();
  const labels = LABELS[locale] || LABELS.en;
  const analysisPanelId = React.useId();

  const [data, setData] = React.useState<EnrichResponse | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [showAnalysis, setShowAnalysis] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setData(null);
    setShowAnalysis(false);

    void fetch(`/api/enrich?listingId=${encodeURIComponent(listingId)}`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<EnrichResponse>;
      })
      .then((payload) => {
        if (!controller.signal.aborted) {
          setData(payload);
          setStatus("ready");
        }
      })
      .catch((err) => {
        if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
          return;
        }
        setStatus("error");
      });

    return () => {
      controller.abort();
    };
  }, [listingId]);

  const hasAiNarrative = Boolean(data?.aiNarrative && data.aiNarrative.trim());
  const modelLabel = data?.model && data.model.trim() ? data.model.trim() : labels.deterministicBadge;

  return (
    <section
      data-testid="ai-briefing-card"
      aria-label={hasAiNarrative ? labels.eyebrow : labels.observedTitle}
      className="rounded-card border border-line bg-card p-5 shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-ink-2" aria-hidden />
          <h2 className="text-base font-bold text-ink">
            {hasAiNarrative ? labels.eyebrow : labels.observedTitle}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasAiNarrative && (
            <span className="rounded-full border border-line bg-paper px-2.5 py-0.5 text-label font-semibold text-ink-2">
              {labels.cachedZeroCostBadge}
            </span>
          )}
          <span
            data-testid="ai-briefing-model"
            className="rounded-full border border-line bg-paper px-2.5 py-0.5 text-label font-semibold text-ink-2"
          >
            {status === "ready" ? modelLabel : labels.deterministicBadge}
          </span>
        </div>
      </div>

      {status === "loading" && (
        <p className="mt-3 text-sm text-ink-3">{labels.loading}</p>
      )}

      {status === "error" && (
        <p className="mt-3 rounded-control border border-line bg-paper px-3.5 py-2.5 text-xs leading-relaxed text-ink-2">
          {labels.unavailable}
        </p>
      )}

      {status === "ready" && data && (
        <>
          <div
            data-testid="ai-briefing-unverified-notice"
            className="mt-3 flex items-start gap-2.5 rounded-control border border-catch/30 bg-catch-wash px-3.5 py-2.5 text-xs leading-relaxed text-catch-ink"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-catch-ink" aria-hidden />
            <div>
              <p className="font-bold">{labels.unverifiedNotice}</p>
              <p className="mt-0.5">{labels.unverifiedDetail}</p>
            </div>
          </div>

          {hasAiNarrative ? (
            <div className="mt-3 space-y-3">
              <div data-testid="ai-briefing-narrative" className="text-sm leading-relaxed text-ink-2 whitespace-pre-line">
                {decodeBasicEntities(data.aiNarrative!.trim())}
              </div>
              {data.analysis && (
                <div>
                  <button
                    type="button"
                    aria-expanded={showAnalysis}
                    aria-controls={analysisPanelId}
                    onClick={() => setShowAnalysis((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 rounded-control border border-line bg-paper px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-line"
                  >
                    {showAnalysis ? labels.inspectEvidenceHide : labels.inspectEvidenceShow}
                    {showAnalysis ? (
                      <ChevronUp className="h-3.5 w-3.5 text-ink-3" aria-hidden />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-ink-3" aria-hidden />
                    )}
                  </button>
                  {showAnalysis && (
                    <div
                      id={analysisPanelId}
                      data-testid="ai-briefing-analysis-panel"
                      className="mt-3 rounded-control border border-line bg-paper p-4"
                    >
                      <StructuredSummaryText text={data.analysis} />
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-2.5">
              <p className="text-xs text-ink-3">{labels.noBriefingFallbackNote}</p>
              {data.analysis ? (
                <div
                  data-testid="ai-briefing-analysis-panel"
                  className="rounded-control border border-line bg-paper p-4"
                >
                  <StructuredSummaryText text={data.analysis} />
                </div>
              ) : (
                <p className="text-xs text-ink-2">{labels.unavailable}</p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
