import { CalendarClock, FileText, GitCompareArrows, ShieldCheck } from "lucide-react";
import type { PropertyListing } from "@/components/terminal/property-data";
import { displayDate, displayMoney, displayText } from "@/lib/listing-display";
import { sourceDisplayText } from "@/lib/source-display";

function value(value: unknown, fallback = "Not established") { return displayText(value, fallback); }

/** Facts are shown as publisher observations, never as bidding instructions. */
export function SaleMechanics({ listing, exactSourceUrl }: { listing: PropertyListing; exactSourceUrl: string | null }) {
  const provenance = listing.provenance || {};
  const documents = provenance.media && typeof provenance.media === "object" ? (provenance.media as Record<string, unknown>).documents : null;
  const hasDocuments = listing.hasDocuments === true || (Array.isArray(documents) && documents.length > 0);
  const events = [
    ["Publisher record observed", listing.sourceObservedAt || provenance.observedAt],
    ["Publisher update captured", listing.fetchedAt || (provenance as Record<string, unknown>).updatedAt],
    ["Documents observed", hasDocuments ? "Publisher document inventory captured" : null],
  ] as const;
  return <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="sale-mechanics-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-emerald-700"><ShieldCheck size={15} />Publisher-observed sale mechanics</p><h2 id="sale-mechanics-heading" className="mt-2 text-xl font-bold">Terms, lifecycle, and evidence state</h2></div><span className="rounded-full bg-amber-50 px-3 py-1 text-[10px] font-bold text-amber-950">No bidding or payment actions here</span></div>
    <dl className="mt-5 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2"><Fact label="Program / mechanism" value={listing.program} /><Fact label="Lifecycle" value={listing.lifecycle || listing.status} /><Fact label="Reported sale date" value={displayDate(listing.saleDate)} /><Fact label="Published opening amount" value={displayMoney(listing.openingBid)} /><Fact label="Occupancy / access" value={listing.occupancy} /><Fact label="Published deposit text" value={listing.deposit} /><Fact label="Public bid count" value={(provenance as Record<string, unknown>).publicBidCount} /><Fact label="Reserve signal" value={(provenance as Record<string, unknown>).reserveMet} /><Fact label="Sale completion" value={(provenance as Record<string, unknown>).saleCompletion} /><Fact label="Publisher documents" value={hasDocuments ? "Observed; review each source document" : undefined} /></dl>
    <div className="mt-6 border-t border-slate-200 pt-5"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-600"><GitCompareArrows size={14} />Evidence timeline</p><ol className="mt-3 space-y-3">{events.map(([label, date]) => <li key={label} className="flex gap-3 text-xs"><span className="mt-1 h-2.5 w-2.5 rounded-full bg-[#0F172A]" /><div><strong>{label}</strong><p className="mt-0.5 text-slate-500">{typeof date === "string" ? displayDate(date, date) : "Not established"}</p></div></li>)}</ol></div>
    {exactSourceUrl ? <a href={exactSourceUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-slate-900 underline hover:text-slate-700"><FileText size={14} />Open the exact publisher record to verify terms</a> : <p className="mt-5 text-xs text-amber-900">An exact publisher record has not been captured, so terms and lifecycle need source verification.</p>}
  </section>;
}

function Fact({ label, value: raw }: { label: string; value: unknown }) { const rendered = typeof raw === "boolean" ? (raw ? "Publisher signal observed" : "Publisher signal not observed") : value(raw); return <div className="border-b border-slate-100 pb-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-slate-950">{sourceDisplayText(rendered)}</dd></div>; }
