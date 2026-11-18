"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { RefreshCw, Home, AlertOctagon } from "lucide-react";
import { useLocale } from "@/components/i18n/locale-provider";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { messages, format } = useLocale();
  const t = messages.errors;
  useEffect(() => {
    console.error("Uncaught application error:", error);
  }, [error]);

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-ink text-white flex flex-col items-center justify-center p-6 text-center outline-none">
      <div className="max-w-md w-full space-y-6">
        <div className="w-16 h-16 rounded-card bg-catch-wash border border-catch/30 text-catch-ink flex items-center justify-center mx-auto">
          <AlertOctagon className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-mono uppercase tracking-widest text-catch-wash">{t.pageUnavailableTag}</p>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            {t.pageErrorTitle}
          </h1>
          <p className="text-sm text-white/75 leading-relaxed">
            {t.pageErrorBody}
          </p>
          {error.digest && (
            <p className="text-label font-mono text-white/60 pt-1">
              {format(t.errorReference, { digest: error.digest })}
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
          <button
            onClick={() => reset()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-control bg-go-fill text-ink text-xs font-bold hover:bg-go-fill/85 transition shadow-sm"
          >
            <RefreshCw className="w-4 h-4" />
            <span>{t.tryAgain}</span>
          </button>

          <Link
            href="/listings"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-control bg-white/10 border border-white/15 text-white text-xs font-bold hover:bg-white/15 transition shadow-sm"
          >
            <Home className="w-4 h-4" />
            <span>{t.returnProperties}</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
