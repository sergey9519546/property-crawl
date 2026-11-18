"use client";

import * as React from "react";
import { Check, ChevronDown, Globe } from "lucide-react";
import { LOCALES, LOCALE_META } from "@/lib/i18n/config";
import { useLocale } from "./locale-provider";
import { cn } from "@/lib/utils";

type SwitcherProps = {
  variant?: "dropdown" | "inline";
  align?: "left" | "right";
  className?: string;
};

export function LanguageSwitcher({
  variant = "dropdown",
  align = "right",
  className,
}: SwitcherProps) {
  const { locale, setLocale, messages } = useLocale();
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (variant === "inline") {
    return (
      <div
        role="group"
        aria-label={messages.common.switchLanguageAria}
        className={cn("inline-flex flex-wrap items-center gap-1.5", className)}
        data-testid="language-switcher-inline"
      >
        {LOCALES.map((code) => {
          const meta = LOCALE_META[code];
          const active = locale === code;
          return (
            <button
              key={code}
              type="button"
              lang={code}
              aria-pressed={active}
              onClick={() => setLocale(code)}
              data-testid={`lang-option-${code}`}
              className={cn(
                "inline-flex h-8 items-center rounded-control border px-2.5 text-xs font-semibold transition-colors",
                active
                  ? "border-ink bg-ink text-white"
                  : "border-line-strong bg-card text-ink-2 hover:bg-paper hover:text-ink",
              )}
            >
              {meta.nativeLabel}
            </button>
          );
        })}
      </div>
    );
  }

  const current = LOCALE_META[locale];

  return (
    <div ref={rootRef} className={cn("relative", className)} data-testid="language-switcher">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${messages.common.switchLanguageAria}: ${current.nativeLabel}`}
        data-testid="language-switcher-trigger"
        className="inline-flex h-10 items-center gap-1.5 rounded-control border border-line-strong bg-card/85 px-2.5 text-xs font-semibold text-ink-2 transition-colors hover:bg-card hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-3"
      >
        <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span lang={locale}>{current.shortLabel}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label={messages.common.languageLabel}
          className={cn(
            "absolute top-[calc(100%+6px)] z-[60] min-w-[172px] overflow-hidden rounded-control border border-line bg-card p-1 shadow-[0_12px_32px_rgba(24,21,41,0.12)]",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {LOCALES.map((code) => {
            const meta = LOCALE_META[code];
            const active = locale === code;
            return (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                lang={code}
                data-testid={`lang-option-${code}`}
                onClick={() => {
                  setLocale(code);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-meta font-medium transition-colors",
                  active ? "bg-paper font-semibold text-ink" : "text-ink-2 hover:bg-paper hover:text-ink",
                )}
              >
                <span>{meta.nativeLabel}</span>
                <span className="flex items-center gap-1.5 text-label uppercase text-ink-3">
                  {meta.shortLabel}
                  {active ? <Check className="h-3.5 w-3.5 text-ink" aria-hidden /> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
