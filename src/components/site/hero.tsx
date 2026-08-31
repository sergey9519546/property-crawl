"use client";

import * as React from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { ArrowUp, Undo2, LayoutGrid, MousePointerClick } from "lucide-react";
import { EASE_OUT } from "./motion";
import { UnicornHeroBg } from "./unicorn-hero-bg";
import { ErrorBoundary } from "./error-boundary";

const H1_WORDS = ["Every", "distressed", "deal", "in", "America,", "in", "one", "feed."];

/**
 * Hero — Unicorn Studio WebGL shader in a rounded panel (arcade structure).
 * Frosted glass applied ONLY to the URL input field (glass-input token).
 * Toggle and buttons use solid/opaque styling (NOT pill, NOT glass).
 */
export function Hero() {
  const [mode, setMode] = React.useState<"deals" | "shadow">("deals");
  const [url, setUrl] = React.useState("");

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springConfig = { stiffness: 50, damping: 20, mass: 0.5 };
  const px = useSpring(mouseX, springConfig);
  const py = useSpring(mouseY, springConfig);
  const contentX = useTransform(px, [-0.5, 0.5], [-8, 8]);
  const contentY = useTransform(py, [-0.5, 0.5], [-4, 4]);

  const onMouseMove = React.useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseX.set((e.clientX - rect.left) / rect.width - 0.5);
    mouseY.set((e.clientY - rect.top) / rect.height - 0.5);
  }, [mouseX, mouseY]);

  const placeholder =
    mode === "deals"
      ? "https://yourcountyassessor.com/parcel"
      : "Paste a parcel address or APN…";

  return (
    <section
      className="relative isolate w-full overflow-visible pt-[120px] pb-[120px] sm:pt-[192px] sm:pb-[184px]"
      
      onMouseMove={onMouseMove}
    >
      {/* Arcade panel: rounded rectangle, inset 16px, #F9FAFB, overflow hidden */}
      <div
        aria-hidden
        className="absolute inset-4 z-0 overflow-hidden rounded-2xl bg-[#F5F6F7]"
      >
        {/* Unicorn Studio WebGL flow-field shader (base texture + Perlin noise) */}
        <ErrorBoundary>
          <UnicornHeroBg />
        </ErrorBoundary>
        {/* Fallback static image while shader loads */}
        <motion.div
          aria-hidden
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          className="absolute inset-0 bg-cover bg-no-repeat"
          style={{
            backgroundImage: "url(/hero-blob.jpg)",
            backgroundPosition: "center bottom",
          }}
        />
      </div>

      {/* Content */}
      <motion.div
        className="relative z-10 mx-auto flex max-w-[1080px] flex-col items-center px-5 text-center"
        style={{ x: contentX, y: contentY }}
      >
        <motion.h1
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.6, ease: EASE_OUT }}
          className="text-[32px] font-semibold leading-[36px] tracking-[-0.02em] text-[#111827] sm:text-[48px] sm:leading-[52px]"
          style={{ margin: 0, maxWidth: 600 }}
        >
          <span className="sr-only">Every distressed deal in America, in one feed.</span>
          <span aria-hidden className="flex flex-wrap justify-center gap-x-[0.25em]">
            {H1_WORDS.map((w, i) => (
              <motion.span
                key={i}
                className="inline-block"
                initial={{ opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 1, delay: 0.6 + i * 0.06, ease: EASE_OUT }}
              >
                {w}
              </motion.span>
            ))}
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.9, ease: EASE_OUT }}
          className="mt-4 sm:mt-[28px] max-w-[620px] text-[16px] font-normal leading-[1.5] text-[rgba(17,24,39,0.8)]"
        >
          11 federal, GSE, and county sources &mdash; HUD, Fannie, Freddie, VA,
          USDA, IRS, Treasury, sheriff sales, and more. AI reads the legal
          notice, scores the deal, and tells you what the catch is &mdash; before
          you put up the deposit.
        </motion.p>

        {/* Toggle — solid opaque, rounded-2xl (NOT pill, NOT glass) */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 1.0, ease: EASE_OUT }}
          className="mt-8 sm:mt-20 inline-flex items-center gap-1 rounded-2xl p-1"
          style={{ background: "rgba(17,24,39,0.14)" }}
        >
          {(["deals", "shadow"] as const).map((m) => {
            const Icon = m === "deals" ? LayoutGrid : MousePointerClick;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`relative inline-flex h-9 items-center justify-center gap-1.5 px-5 text-[14px] font-medium capitalize transition-colors ${
                  mode === m ? "text-[#111827]" : "text-white/90 hover:text-white"
                }`}
                style={{ minWidth: 80 }}
              >
                {mode === m && (
                  <motion.span
                    layoutId="hero-toggle"
                    className="absolute inset-0 rounded-xl bg-white shadow-[0_1px_2px_rgba(17,24,39,0.06),0_1px_3px_rgba(17,24,39,0.05)]"
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  />
                )}
                <Icon className="relative z-10 h-3.5 w-3.5" strokeWidth={1.75} />
                <span className="relative z-10">{m}</span>
              </button>
            );
          })}
        </motion.div>

        {/* Frosted glass URL input — glass-input token */}
        <motion.form
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 1.1, ease: EASE_OUT }}
          onSubmit={(e) => e.preventDefault()}
          className="mt-2 flex h-[68px] items-center rounded-3xl px-6"
          style={{
            width: "100%",
            maxWidth: "min(444px, calc(100vw - 40px))",
            background: "rgba(255,255,255,0.85)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            border: "1px solid rgba(255,255,255,0.8)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.7)",
            willChange: "backdrop-filter",
          }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            type="text"
            placeholder={placeholder}
            className="min-w-0 flex-1 bg-transparent text-[18px] leading-none text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none"
          />
          <button
            type="submit"
            aria-label="Generate deal"
            className="inline-flex h-[44px] w-[44px] sm:h-[34px] sm:w-[34px] shrink-0 items-center justify-center rounded-full bg-[#0F172A] text-white transition-colors hover:bg-[#1E293B]"
            style={{
              boxShadow: "0 0 0 1px rgb(15,23,42), 0 4px 8px rgba(15,23,42,0.18)",
            }}
          >
            <ArrowUp className="h-[19px] w-[19px]" />
          </button>
        </motion.form>

        {/* Try with your parcel */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 1.25, ease: EASE_OUT }}
          className="mt-[30px] flex items-center gap-1.5 text-[15px] font-medium text-[#FFFFFF]"
        >
          <Undo2 className="h-4 w-4 text-[#0F172A]" />
          Try with your parcel!
        </motion.div>
      </motion.div>
    </section>
  );
}
