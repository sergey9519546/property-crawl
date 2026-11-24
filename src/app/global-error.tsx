"use client";

import React, { useEffect, useState } from "react";
import { RefreshCw, AlertOctagon } from "lucide-react";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { interpolate } from "@/lib/i18n/translator";
import { captureException } from "@/lib/telemetry/sentry";

function readBrowserLocale(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const cookieMatch = document.cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`));
  if (cookieMatch?.[1] && isLocale(cookieMatch[1])) return cookieMatch[1];
  if (isLocale(document.documentElement.lang)) return document.documentElement.lang;
  return DEFAULT_LOCALE;
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => {
    setLocale(readBrowserLocale());
    console.error("Uncaught root layout error:", error);
    void captureException(error, {
      handled: false,
      mechanismType: "react.global_error",
      tags: {
        runtime: "browser",
        surface: "global-error",
        ...(error?.digest ? { digest: error.digest } : {}),
      },
      extra: error?.digest ? { digest: error.digest } : undefined,
    });
  }, [error]);
  const t = getMessages(locale).errors;

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-ink text-white antialiased">
        <main id="main-content" tabIndex={-1} className="min-h-screen flex flex-col items-center justify-center p-6 text-center outline-none">
          <div className="max-w-md w-full space-y-6">
            <div className="w-16 h-16 rounded-card bg-catch-wash border border-catch/30 text-catch-ink flex items-center justify-center mx-auto">
              <AlertOctagon className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-mono uppercase tracking-widest text-catch-wash">
                {t.appUnavailableTag}
              </p>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                {t.globalErrorTitle}
              </h1>
              <p className="text-sm text-white/75 leading-relaxed">
                {t.globalErrorBody}
              </p>
              {error.digest && (
                <p className="text-label font-mono text-white/60 pt-1">
                  {interpolate(t.errorReference, { digest: error.digest })}
                </p>
              )}
            </div>

            <button
              onClick={() => reset()}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-control bg-go-fill text-ink text-xs font-bold hover:bg-go-fill/85 transition shadow-sm"
            >
              <RefreshCw className="w-4 h-4" />
              <span>{t.tryAgain}</span>
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
