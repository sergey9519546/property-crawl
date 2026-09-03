import React from "react";
import Link from "next/link";
import { ArrowLeft, Home, Search, AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0F172A] text-white flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
          <AlertCircle className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-mono uppercase tracking-widest text-amber-400">404 — Not Found</p>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Listing or Page Unavailable
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            The foreclosure docket or route you requested could not be located. It may have cleared auction or been updated.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
          <Link
            href="/"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white text-[#0F172A] text-xs font-bold hover:bg-slate-100 transition shadow-sm"
          >
            <Home className="w-4 h-4" />
            <span>Return to Terminal</span>
          </Link>

          <Link
            href="/listings"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white/10 border border-white/15 text-white text-xs font-bold hover:bg-white/15 transition shadow-sm"
          >
            <Search className="w-4 h-4 text-emerald-400" />
            <span>Browse All Listings</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
