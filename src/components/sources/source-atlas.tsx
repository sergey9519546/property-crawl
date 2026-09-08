import { BookOpen, ExternalLink, Layers3 } from "lucide-react";
import { sourceDisplayText } from "@/lib/source-display";

export type AtlasSource = { id: string; label: string; urls?: string[]; access?: string; authorStatus?: string; automationStatus?: string; evidenceClass?: string; capabilityClaim?: string; limitations?: string };
export type SourceAtlasData = { sources: AtlasSource[]; total: number; ledgerRows?: number; unmappedLedgerRows?: number };

const ACCESS: Record<string, string> = {
  manual: "Manual lookup",
  public: "Public access",
  account: "Account required",
  licensed: "License required",
  jurisdiction: "Local access varies",
};

const CONNECTION: Record<string, string> = {
  backlog: "Not connected",
  manual: "Manual only",
  blocked: "Blocked",
  operational: "Connected after an observed run",
};

const REVIEW_PREFIXES: [string, string][] = [
  ["VERIFIED - official", "Official source checked"],
  ["VERIFIED - first-party", "Provider source checked"],
  ["VERIFIED - scope limited", "Scope partly confirmed"],
  ["VERIFIED SOURCE - dynamic claim", "Source checked; details can change"],
  ["LIVE SOURCE - claim limited", "Source reachable; full claim unconfirmed"],
  ["INCONCLUSIVE - access blocked", "Access blocked; capability unconfirmed"],
  ["DISCOVERY ONLY", "Lead only; primary source required"],
];

function reviewState(value?: string) {
  if (!value) return { label: "Not reviewed", detail: "No review result has been recorded." };
  const match = REVIEW_PREFIXES.find(([prefix]) => value.startsWith(prefix));
  if (!match) return { label: "Needs review", detail: value };
  return { label: match[1], detail: value.slice(match[0].length).trim() || "No additional limitation was recorded." };
}

function classification(value: string | undefined, labels: Record<string, string>, fallback: string) {
  return value ? labels[value.toLowerCase()] || value.replaceAll("_", " ") : fallback;
}

export function SourceAtlas({ atlas, storageMode }: { atlas?: SourceAtlasData; storageMode?: string }) {
  if (!atlas) return null;
  return <section className="mt-9" aria-labelledby="source-atlas-heading">
    <details className="rounded-2xl border border-slate-200 bg-white px-5 shadow-sm sm:px-7">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 py-5">
        <span><span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.15em] text-emerald-700"><Layers3 size={16} />Coverage setup</span><span id="source-atlas-heading" className="mt-1 block text-xl font-semibold">Sources not connected yet</span><span className="mt-1 block max-w-3xl text-sm leading-6 text-slate-600">Candidate references for future coverage. These rows do not prove access, collection, or property availability.</span></span>
        <span className="rounded-xl bg-slate-50 px-4 py-3 text-right text-xs"><strong className="block">{atlas.total} source references</strong><span className="mt-1 block text-slate-500">{atlas.ledgerRows ?? 0} source mentions · {atlas.unmappedLedgerRows ?? 0} not mapped to a workflow</span></span>
      </summary>
      <div className="border-t border-slate-200 pb-6 pt-5">
        {storageMode ? <p className="mb-4 text-xs text-slate-500">Coverage store: {storageMode}</p> : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{atlas.sources.map((source) => {
          const review = reviewState(source.authorStatus);
          return <article key={source.id} className="rounded-xl border border-slate-200 p-4"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-700">{source.evidenceClass === "document_claim" ? "Reference only" : classification(source.evidenceClass, {}, "Reference only")}</p><h3 className="mt-2 font-semibold">{sourceDisplayText(source.label)}</h3>{source.capabilityClaim ? <p className="mt-2 text-xs leading-5 text-slate-600">{sourceDisplayText(source.capabilityClaim)}</p> : null}<dl className="mt-3 space-y-2 text-xs text-slate-600"><div className="flex justify-between gap-3"><dt>Access</dt><dd className="text-right font-medium">{classification(source.access, ACCESS, "Not established")}</dd></div><div className="flex justify-between gap-3"><dt>Connection</dt><dd className="text-right font-medium">{classification(source.automationStatus, CONNECTION, "Not connected")}</dd></div><div className="flex justify-between gap-3"><dt>Review</dt><dd className="text-right font-medium">{review.label}</dd></div></dl><p className="mt-3 rounded-lg bg-amber-50 p-3 text-[11px] leading-5 text-amber-950">{sourceDisplayText(review.detail || source.limitations || "Current access and coverage still need review.")}</p>{source.urls?.[0] ? <a href={source.urls[0]} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-slate-900 underline hover:text-slate-700">Review source <ExternalLink size={12} /></a> : <p className="mt-4 flex items-center gap-1 text-xs text-slate-500"><BookOpen size={12} />No public reference URL captured</p>}</article>;
        })}</div>
        {!atlas.sources.length ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No coverage references have been loaded.</p> : null}
      </div>
    </details>
  </section>;
}
