"use client";

import React, { useEffect } from "react";
import { RefreshCw, AlertOctagon } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Uncaught root layout error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-ink text-white antialiased">
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md w-full space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-catch-wash border border-catch/30 text-catch-ink flex items-center justify-center mx-auto">
              <AlertOctagon className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-mono uppercase tracking-widest text-catch-ink">
                Application unavailable
              </p>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                Something went wrong
              </h1>
              <p className="text-sm text-white/75 leading-relaxed">
                The workspace hit an unexpected error. Try again. Your saved work remains on this machine.
              </p>
              {error.digest && (
                <p className="text-[11px] font-mono text-white/60 pt-1">
                  Error reference: {error.digest}
                </p>
              )}
            </div>

            <button
              onClick={() => reset()}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-go-fill text-ink text-xs font-bold hover:bg-go-fill/85 transition shadow-sm"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Try Again</span>
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
