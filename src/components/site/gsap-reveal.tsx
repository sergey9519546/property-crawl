"use client";

import * as React from "react";
import gsap from "gsap";

/** Arcade-exact ease curves */
export const EASE_OUT = "power2.out" as const;
export const EASE_POWER3 = "power3.out" as const;

function isNearOrAboveViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.top <= window.innerHeight + 120;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * GSAP-powered scroll reveal with guaranteed visibility:
 * elements already in/above the viewport animate immediately,
 * IntersectionObserver uses generous rootMargin + threshold 0.01,
 * and a scroll/timer fallback ensures no section can stay stuck at opacity 0.
 */
export function useGsapReveal<T extends HTMLElement = HTMLDivElement>(
  options: { delay?: number; y?: number; duration?: number } = {}
) {
  const ref = React.useRef<T>(null);
  const { delay = 0.15, y = 16, duration = 0.65 } = options;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (prefersReducedMotion()) {
      gsap.set(el, { opacity: 1, y: 0, clearProps: "transform" });
      return;
    }

    let revealed = false;
    const revealNow = (immediate = false) => {
      if (revealed) return;
      revealed = true;
      gsap.to(el, {
        opacity: 1,
        y: 0,
        duration: immediate ? 0.35 : duration,
        delay: immediate ? 0 : Math.min(delay, 0.2),
        ease: EASE_OUT,
        overwrite: "auto",
        clearProps: "transform",
      });
    };

    if (isNearOrAboveViewport(el)) {
      gsap.set(el, { opacity: 0, y: Math.min(y, 12) });
      revealNow(true);
      return;
    }

    gsap.set(el, { opacity: 0, y });

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting || entry.boundingClientRect.top <= window.innerHeight + 120)) {
            revealNow();
            observer?.disconnect();
          }
        },
        { threshold: 0.01, rootMargin: "120px 0px 120px 0px" }
      );
      observer.observe(el);
    } else {
      revealNow(true);
    }

    const onScroll = () => {
      if (isNearOrAboveViewport(el)) {
        revealNow();
        observer?.disconnect();
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    const fallbackTimer = window.setTimeout(() => {
      revealNow(true);
      observer?.disconnect();
    }, 1200);

    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(fallbackTimer);
      gsap.killTweensOf(el);
    };
  }, [delay, y, duration]);

  return ref;
}

/** Reveal wrapper component using GSAP */
export function GsapReveal({
  children,
  delay = 0.15,
  y = 16,
  className,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: "div" | "section" | "li" | "span" | "article";
}) {
  const ref = useGsapReveal<HTMLDivElement>({ delay, y });
  const Component = Tag as React.ElementType;
  return (
    <Component ref={ref} className={className}>
      {children}
    </Component>
  );
}

/** Stagger group: reveals children with stagger when the group enters viewport */
export function useGsapStagger<T extends HTMLElement = HTMLDivElement>(
  stagger: number = 0.1,
  delay: number = 0.12
) {
  const ref = React.useRef<T>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const items = el.querySelectorAll("[data-stagger-item]");
    if (!items.length) return;

    if (prefersReducedMotion()) {
      gsap.set(items, { opacity: 1, y: 0, clearProps: "transform" });
      return;
    }

    let revealed = false;
    const revealNow = (immediate = false) => {
      if (revealed) return;
      revealed = true;
      gsap.to(items, {
        opacity: 1,
        y: 0,
        duration: immediate ? 0.35 : 0.65,
        delay: immediate ? 0 : Math.min(delay, 0.2),
        stagger: immediate ? Math.min(stagger, 0.06) : stagger,
        ease: EASE_OUT,
        overwrite: "auto",
        clearProps: "transform",
      });
    };

    if (isNearOrAboveViewport(el)) {
      gsap.set(items, { opacity: 0, y: 12 });
      revealNow(true);
      return;
    }

    gsap.set(items, { opacity: 0, y: 16 });

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting || entry.boundingClientRect.top <= window.innerHeight + 120)) {
            revealNow();
            observer?.disconnect();
          }
        },
        { threshold: 0.01, rootMargin: "120px 0px 120px 0px" }
      );
      observer.observe(el);
    } else {
      revealNow(true);
    }

    const onScroll = () => {
      if (isNearOrAboveViewport(el)) {
        revealNow();
        observer?.disconnect();
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    const fallbackTimer = window.setTimeout(() => {
      revealNow(true);
      observer?.disconnect();
    }, 1200);

    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(fallbackTimer);
      gsap.killTweensOf(items);
    };
  }, [stagger, delay]);

  return ref;
}

export function GsapStaggerGroup({
  children,
  className,
  stagger = 0.1,
  delay = 0.12,
}: {
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
}) {
  const ref = useGsapStagger<HTMLDivElement>(stagger, delay);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
