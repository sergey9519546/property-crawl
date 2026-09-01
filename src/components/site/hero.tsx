"use client";

import * as React from "react";
import Image from "next/image";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { ArrowUp, Building2, Flag, Globe2, House, Map as MapIcon, MapPin, Undo2 } from "lucide-react";
import { EASE_OUT } from "./motion";
import { UnicornHeroBg } from "./unicorn-hero-bg";
import { ErrorBoundary } from "./error-boundary";

const H1_WORDS = ["Find", "the", "deal", "before", "everyone", "else."];

type MarketSuggestion = {
  id: string;
  label: string;
  query: string;
  kind: "address" | "city" | "county" | "state" | "area" | "country";
  description: string;
};

type ListingMarket = {
  id: string;
  address: string;
  city: string;
  county: string;
  state: string;
  zip: string;
};

const STATE_NAMES: Record<string, string> = {
  AZ: "Arizona",
  FL: "Florida",
  GA: "Georgia",
  IL: "Illinois",
  NJ: "New Jersey",
  NV: "Nevada",
  OH: "Ohio",
  PA: "Pennsylvania",
  TX: "Texas",
};

const KIND_ORDER: MarketSuggestion["kind"][] = [
  "city",
  "county",
  "state",
  "area",
  "address",
  "country",
];

/**
 * Hero — Unicorn Studio WebGL shader in a rounded panel (arcade structure).
 * Frosted glass applied ONLY to the URL input field (glass-input token).
 * Toggle and buttons use solid/opaque styling (NOT pill, NOT glass).
 */
export function Hero() {
  const [url, setUrl] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [selectedMarket, setSelectedMarket] = React.useState<MarketSuggestion | null>(null);
  const [suggestions, setSuggestions] = React.useState<MarketSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = React.useState(false);
  const [activeSuggestion, setActiveSuggestion] = React.useState(-1);
  const blurTimerRef = React.useRef<number | null>(null);
  const deferredUrl = React.useDeferredValue(url.trim());

  React.useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
    };
  }, []);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springConfig = { stiffness: 58, damping: 22, mass: 0.55 };
  const px = useSpring(mouseX, springConfig);
  const py = useSpring(mouseY, springConfig);
  const shaderX = useTransform(px, [-0.5, 0.5], [-18, 18]);
  const shaderY = useTransform(py, [-0.5, 0.5], [-12, 12]);

  const onMouseMove = React.useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set((e.clientX - rect.left) / rect.width - 0.5);
    mouseY.set((e.clientY - rect.top) / rect.height - 0.5);
  }, [mouseX, mouseY]);

  const onMouseLeave = React.useCallback(() => {
    mouseX.set(0);
    mouseY.set(0);
  }, [mouseX, mouseY]);

  const placeholder = "City, county, state, country, ZIP, or address";

  React.useEffect(() => {
    if (deferredUrl.length < 2 || /^https?:\/\//i.test(deferredUrl)) {
      setSuggestions([]);
      setSuggestionsOpen(false);
      return;
    }

    if (selectedMarket?.label === deferredUrl) {
      setSuggestionsOpen(false);
      return;
    }

    const controller = new AbortController();
    const normalizedQuery = deferredUrl.toLowerCase();

    fetch("/api/listings", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!payload?.listings || controller.signal.aborted) return;
        const markets = new Map<string, MarketSuggestion>();
        markets.set("country:US", {
          id: "country:US",
          label: "United States",
          query: "",
          kind: "country",
          description: "Country coverage",
        });
        for (const listing of payload.listings as ListingMarket[]) {
          const suggestionsForListing: MarketSuggestion[] = [
            {
              id: `address:${listing.id}`,
              label: listing.address,
              query: listing.city,
              kind: "address",
              description: `Address nearby ${listing.city}`,
            },
            {
              id: `city:${listing.city}:${listing.state}`,
              label: `${listing.city}, ${listing.state}`,
              query: listing.city,
              kind: "city",
              description: "City market",
            },
            {
              id: `county:${listing.county}:${listing.state}`,
              label: `${listing.county} County, ${listing.state}`,
              query: listing.county,
              kind: "county",
              description: "County market",
            },
            {
              id: `state:${listing.state}`,
              label: STATE_NAMES[listing.state] || listing.state,
              query: listing.state,
              kind: "state",
              description: "State",
            },
            {
              id: `area:${listing.zip}:${listing.city}`,
              label: `${listing.zip} \u2014 ${listing.city} area`,
              query: listing.zip,
              kind: "area",
              description: "ZIP area",
            },
          ];
          for (const suggestion of suggestionsForListing) {
            markets.set(suggestion.id, suggestion);
          }
        }
        const matches = Array.from(markets.values())
          .filter((market) => market.label.toLowerCase().includes(normalizedQuery))
          .sort((a, b) => {
            const aStarts = a.label.toLowerCase().startsWith(normalizedQuery) ? 0 : 1;
            const bStarts = b.label.toLowerCase().startsWith(normalizedQuery) ? 0 : 1;
            return aStarts - bStarts || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.label.localeCompare(b.label);
          })
          .slice(0, 6);
        setSuggestions(matches);
        setSuggestionsOpen(matches.length > 0);
        setActiveSuggestion(-1);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSuggestions([]);
          setSuggestionsOpen(false);
        }
      });

    return () => controller.abort();
  }, [deferredUrl, selectedMarket]);

  const selectSuggestion = (suggestion: MarketSuggestion) => {
    setUrl(suggestion.label);
    setSelectedMarket(suggestion);
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
    setStatus(`${suggestion.label} selected.`);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const label = url.trim();
    const query = selectedMarket?.label === label ? selectedMarket.query : label;

    if (!label) {
      setStatus("Enter a city, county, state, country, ZIP, or address first.");
      return;
    }

    window.dispatchEvent(
      new CustomEvent("perfectproperty:search", {
        detail: { query, scope: selectedMarket?.kind || "search" },
      }),
    );
    window.location.hash = "live-feed";
    setSuggestionsOpen(false);
    setStatus(`Opened the live feed for ${label}.`);
  };

  return (
    <section
      id="hero"
      className="relative isolate w-full overflow-visible pt-[120px] pb-[340px] sm:pt-[192px] sm:pb-[460px] lg:pb-[540px] xl:min-h-[820px] xl:pb-[184px] xl:pt-[104px]"
      
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      {/* Arcade panel: rounded rectangle, inset 16px, #F9FAFB, overflow hidden */}
      <div
        aria-hidden
        className="absolute inset-4 z-0 overflow-hidden rounded-2xl bg-[#F5F6F7]"
      >
        {/* Fallback static image while shader loads */}
        <div
          aria-hidden
          className="absolute inset-0 z-0 bg-cover bg-no-repeat"
          style={{
            backgroundImage: "url(/hero-blob.jpg)",
            backgroundPosition: "center bottom",
          }}
        />
        {/* Unicorn Studio WebGL flow-field shader (base texture + Perlin noise) */}
        <motion.div
          aria-hidden
          data-testid="hero-shader-field"
          className="pointer-events-none absolute -inset-[5%] z-[1] will-change-transform"
          style={{ x: shaderX, y: shaderY, scale: 1.06 }}
        >
          <ErrorBoundary>
            <UnicornHeroBg />
          </ErrorBoundary>
        </motion.div>

        {/* A local light field keeps the architecture legible without separating it from the shader. */}
        <div aria-hidden className="hero-property-backlight absolute inset-0 z-[2]" />

        {/* Property layer: the supplied transparent villa is colorized by the live shader. */}
        <div
          data-testid="hero-property-blueprint"
          className="hero-property-art absolute inset-0 z-[3]"
        >
          <Image
            src="/hero-modern-villa.png"
            alt=""
            width={1536}
            height={1024}
            preload
            sizes="(max-width: 767px) 132vw, (max-width: 1279px) 90vw, (max-width: 1532px) 920px, (max-width: 1966px) 60vw, 1180px"
            className="absolute bottom-0 right-0 h-auto max-w-none"
          />
        </div>
      </div>

      {/* Content */}
      <motion.div
        data-testid="hero-content"
        className="hero-content relative z-10 mx-auto flex w-full max-w-[2200px] flex-col items-center px-5 text-center sm:px-12"
      >
        <div data-testid="hero-content-stack" className="flex w-full flex-col items-center">
        <motion.h1
          className="text-[32px] font-semibold leading-[36px] tracking-[-0.02em] text-[#111827] sm:text-[48px] sm:leading-[52px]"
          style={{ margin: 0, maxWidth: 620 }}
        >
          <span className="sr-only">Find the deal before everyone else.</span>
          <span aria-hidden className="flex flex-wrap justify-center gap-x-[0.25em]">
            {H1_WORDS.map((w, i) => (
              <motion.span
                key={i}
                className="inline-block"
                initial={{ opacity: 1, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.04 + i * 0.035, ease: EASE_OUT }}
              >
                {w}
              </motion.span>
            ))}
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 1, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.15, ease: EASE_OUT }}
          className="mt-4 max-w-[620px] text-[16px] font-normal leading-[1.5] text-[rgba(17,24,39,0.8)] sm:mt-[28px] xl:mt-3 xl:max-w-[820px]"
        >
          Search any market or address. See the best opportunities, the catch,
          and your next move &mdash; before you bid.
        </motion.p>

        {/* Frosted glass URL input — glass-input token */}
        <motion.form
          initial={{ opacity: 1, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.24, ease: EASE_OUT }}
          onSubmit={handleSubmit}
          className="hero-search-shell relative z-20 mt-8 flex h-[68px] items-center self-center rounded-3xl px-6 sm:mt-16 xl:mt-4"
          style={{
            width: "100%",
            maxWidth: "min(620px, calc(100vw - 40px))",
            background: "rgba(255,255,255,0.85)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.8)",
            willChange: "backdrop-filter",
          }}
        >
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setSelectedMarket(null);
              setStatus("");
            }}
            onFocus={() => {
              if (blurTimerRef.current !== null) {
                window.clearTimeout(blurTimerRef.current);
                blurTimerRef.current = null;
              }
              setSuggestionsOpen(suggestions.length > 0);
            }}
            onBlur={() => {
              if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
              blurTimerRef.current = window.setTimeout(() => {
                setSuggestionsOpen(false);
                blurTimerRef.current = null;
              }, 300);
            }}
            onKeyDown={(event) => {
              if (!suggestionsOpen || suggestions.length === 0) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveSuggestion((current) => Math.min(current + 1, suggestions.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveSuggestion((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter" && activeSuggestion >= 0) {
                event.preventDefault();
                selectSuggestion(suggestions[activeSuggestion]);
              } else if (event.key === "Escape") {
                setSuggestionsOpen(false);
              }
            }}
            type="text"
            role="combobox"
            aria-label="Market or address"
            aria-autocomplete="list"
            aria-controls="hero-address-suggestions"
            aria-expanded={suggestionsOpen}
            aria-activedescendant={
              activeSuggestion >= 0 ? `hero-address-suggestion-${activeSuggestion}` : undefined
            }
            placeholder={placeholder}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[18px] leading-none text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Search market"
            className="inline-flex h-[44px] w-[44px] sm:h-[34px] sm:w-[34px] shrink-0 items-center justify-center rounded-full bg-[#0F172A] text-white transition-colors hover:bg-[#1E293B]"
            style={{
              boxShadow: "0 0 0 1px rgb(15,23,42), 0 4px 8px rgba(15,23,42,0.18)",
            }}
          >
            <ArrowUp className="h-[19px] w-[19px]" />
          </button>

          {suggestionsOpen ? (
            <ul
              id="hero-address-suggestions"
              role="listbox"
              aria-label="Market and address suggestions"
              className="absolute left-0 right-0 top-[calc(100%+8px)] overflow-hidden rounded-2xl border border-white/80 bg-white/95 p-1.5 text-left shadow-[0_18px_48px_rgba(15,23,42,0.2)] backdrop-blur-xl"
            >
              {suggestions.map((suggestion, index) => (
                <li
                  id={`hero-address-suggestion-${index}`}
                  key={suggestion.id}
                  role="option"
                  aria-selected={activeSuggestion === index}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSuggestion(suggestion);
                  }}
                  onClick={() => selectSuggestion(suggestion)}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl px-3.5 py-3 text-[14px] font-medium text-[#111827] transition-colors ${
                    activeSuggestion === index ? "bg-[#E8EEFF]" : "hover:bg-[#F3F4F6]"
                  }`}
                >
                  {suggestion.kind === "address" ? <House className="h-4 w-4 shrink-0 text-[#2563EB]" aria-hidden /> : null}
                  {suggestion.kind === "city" ? <Building2 className="h-4 w-4 shrink-0 text-[#2563EB]" aria-hidden /> : null}
                  {suggestion.kind === "county" ? <MapIcon className="h-4 w-4 shrink-0 text-[#2563EB]" aria-hidden /> : null}
                  {suggestion.kind === "state" ? <Flag className="h-4 w-4 shrink-0 text-[#2563EB]" aria-hidden /> : null}
                  {suggestion.kind === "area" ? <MapPin className="h-4 w-4 shrink-0 text-[#2563EB]" aria-hidden /> : null}
                  {suggestion.kind === "country" ? <Globe2 className="h-4 w-4 shrink-0 text-[#2563EB]" aria-hidden /> : null}
                  <span className="min-w-0 flex-1">{suggestion.label}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#7B8493]">
                    {suggestion.description}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </motion.form>

        {/* Try with your parcel */}
        <motion.button
          type="button"
          onClick={() => {
            const sampleMarket: MarketSuggestion = {
              id: "city:Cleveland:OH",
              label: "Cleveland, OH",
              query: "Cleveland",
              kind: "city",
              description: "City market",
            };
            setUrl(sampleMarket.label);
            setSelectedMarket(sampleMarket);
            setStatus("Cleveland, OH selected. Select Search market to open the live feed.");
          }}
          initial={{ opacity: 1, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.36, ease: EASE_OUT }}
          className="relative mt-[30px] flex items-center gap-1.5 self-center text-[15px] font-medium text-[#FFFFFF] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white xl:mt-5 xl:text-[#0F172A] xl:focus-visible:outline-[#0F172A]"
        >
          <Undo2 className="h-4 w-4 text-[#0F172A]" />
          Try the Cleveland market
        </motion.button>
        <p className="sr-only" aria-live="polite">{status}</p>
        </div>
      </motion.div>
    </section>
  );
}
