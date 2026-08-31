"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CalendarDays, ExternalLink, Gavel, MapPin, TrendingUp } from "lucide-react";
import { Listing, LISTINGS, SOURCES } from "@/data/listings";
import { getExactSourceListingUrl } from "@/lib/listing-links";
import { Logo } from "@/components/site/logo";

type ListingsPayload = { listings?: Listing[] };

export default function ListingPage() {
  const params = useParams<{ id: string }>();
  const listingId = decodeURIComponent(params.id);
  const [listing, setListing] = useState<Listing | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    let active = true;
    fetch("/api/listings", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<ListingsPayload>;
      })
      .then((payload) => {
        if (!active) return;
        const match = payload.listings?.find((item) => item.id === listingId)
          ?? LISTINGS.find((item) => item.id === listingId)
          ?? null;
        setListing(match);
        setStatus(match ? "ready" : "missing");
      })
      .catch(() => {
        if (!active) return;
        const fallback = LISTINGS.find((item) => item.id === listingId) ?? null;
        setListing(fallback);
        setStatus(fallback ? "ready" : "missing");
      });
    return () => {
      active = false;
    };
  }, [listingId]);

  if (status === "loading") {
    return <main className="grid min-h-screen place-items-center bg-[#F5F6F7] text-sm font-semibold text-slate-600">Loading listing…</main>;
  }

  if (!listing || status === "missing") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#F5F6F7] px-6 text-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">Listing unavailable</h1>
          <p className="mt-3 text-slate-600">This record is no longer present in the live feed.</p>
          <Link href="/#live-feed" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white">
            <ArrowLeft className="h-4 w-4" /> Back to the live feed
          </Link>
        </div>
      </main>
    );
  }

  const source = SOURCES[listing.source];
  const exactSourceUrl = getExactSourceListingUrl(listing, source?.websiteUrl);

  return (
    <main className="min-h-screen bg-[#F5F6F7] text-slate-950">
      <header className="border-b border-slate-200 bg-white px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4">
          <Link href="/" aria-label="PerfectProperty home"><Logo className="text-[18px]" /></Link>
          <Link href="/#live-feed" className="inline-flex items-center gap-2 text-sm font-bold text-slate-700 hover:text-slate-950">
            <ArrowLeft className="h-4 w-4" /> Live feed
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1200px] gap-8 px-5 py-10 lg:grid-cols-[1.3fr_0.7fr] lg:px-8 lg:py-14">
        <section>
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <img src={listing.photo} alt={listing.address} className="h-[320px] w-full object-cover sm:h-[460px]" />
            <div className="p-6 sm:p-8">
              <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-emerald-700">
                <span>{source?.label ?? listing.source}</span>
                <span aria-hidden="true">·</span>
                <span>Deal score {listing.dealScore}/100</span>
              </div>
              <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">{listing.address}</h1>
              <p className="mt-3 flex items-center gap-2 text-slate-600"><MapPin className="h-4 w-4" /> {listing.county} County, {listing.state} {listing.zip}</p>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
            <h2 className="text-xl font-bold">Notice and auction details</h2>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Plaintiff</dt><dd className="mt-1 font-semibold">{listing.plaintiff}</dd></div>
              <div><dt className="text-slate-500">Defendant</dt><dd className="mt-1 font-semibold">{listing.defendant}</dd></div>
              <div><dt className="text-slate-500">Attorney</dt><dd className="mt-1 font-semibold">{listing.attorney}</dd></div>
              <div><dt className="text-slate-500">Deposit terms</dt><dd className="mt-1 font-semibold">{listing.deposit}</dd></div>
            </dl>
          </div>
        </section>

        <aside className="space-y-5 lg:sticky lg:top-8 lg:self-start">
          <div className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-8">
            <h2 className="text-lg font-bold">Deal snapshot</h2>
            <dl className="mt-6 space-y-5">
              <div className="flex items-center justify-between gap-4"><dt className="flex items-center gap-2 text-slate-400"><Gavel className="h-4 w-4" /> Opening bid</dt><dd className="text-xl font-bold">${listing.openingBid.toLocaleString()}</dd></div>
              <div className="flex items-center justify-between gap-4"><dt className="flex items-center gap-2 text-slate-400"><TrendingUp className="h-4 w-4" /> Est. value</dt><dd className="font-bold">${listing.estLow.toLocaleString()}–${listing.estHigh.toLocaleString()}</dd></div>
              <div className="flex items-center justify-between gap-4"><dt className="flex items-center gap-2 text-slate-400"><CalendarDays className="h-4 w-4" /> Auction</dt><dd className="font-bold">{listing.saleDate}</dd></div>
            </dl>
          </div>

          {exactSourceUrl ? (
            <a href={exactSourceUrl} target="_blank" rel="noreferrer" data-testid="exact-source-listing-link" className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-center text-sm font-bold text-white hover:bg-emerald-700">
              Open exact source listing <ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <div data-testid="exact-source-listing-unavailable" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-950">
              <strong className="block">Exact upstream record not supplied</strong>
              No generic portal link is shown. The record above is the exact listing page available in this feed.
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
