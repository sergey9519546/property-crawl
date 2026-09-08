"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { RefreshCw, Home, AlertOctagon } from "lucide-react";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Uncaught application error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#0F172A] text-white flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md w-full space-y-6">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mx-auto">
          <AlertOctagon className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-mono uppercase tracking-widest text-red-400">Page unavailable</p>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            This page couldn’t load
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Try loading the page again, or return to property search. Your saved work remains in the workspace.
          </p>
          {error.digest && (
            <p className="text-[11px] font-mono text-slate-500 pt-1">
              Error reference: {error.digest}
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
          <button
            onClick={() => retry()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-500 text-[#0F172A] text-xs font-bold hover:bg-emerald-400 transition shadow-sm"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Try Again</span>
          </button>

          <Link
            href="/listings"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white/10 border border-white/15 text-white text-xs font-bold hover:bg-white/15 transition shadow-sm"
          >
            <Home className="w-4 h-4" />
            <span>Return to properties</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
