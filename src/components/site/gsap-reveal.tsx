"use client";

import * as React from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

/** Arcade-exact ease curves */
export const EASE_OUT = "power2.out" as const;
export const EASE_POWER3 = "power3.out" as const;

/**
 * GSAP-powered scroll reveal. Matches arcade's WowCoolNice keyframe:
 * opacity 0→1, translateY -16px→0, duration 1s, ease-out, delay 0.6s.
 * Triggers when element enters viewport at 80%.
 */
export function useGsapReveal<T extends HTMLElement = HTMLDivElement>(
  options: { delay?: number; y?: number; duration?: number } = {}
) {
  const ref = React.useRef<T>(null);
  const { delay = 0.3, y = 16, duration = 1 } = options;

  React.useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { opacity: 0, y },
        {
          opacity: 1,
          y: 0,
          duration,
          delay,
          ease: EASE_OUT,
          scrollTrigger: {
            trigger: el,
            start: "top 85%",
            toggleActions: "play none none none",
          },
        }
      );
    });
    return () => ctx.revert();
  }, [delay, y, duration]);

  return ref;
}

/** Reveal wrapper component using GSAP */
export function GsapReveal({
  children,
  delay = 0.3,
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
  const Component = Tag as any;
  return (
    <Component ref={ref} className={className}>
      {children}
    </Component>
  );
}

/** Stagger group: reveals children with stagger when the group enters viewport */
export function useGsapStagger<T extends HTMLElement = HTMLDivElement>(
  stagger: number = 0.12,
  delay: number = 0.2
) {
  const ref = React.useRef<T>(null);

  React.useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const items = el.querySelectorAll("[data-stagger-item]");
    if (!items.length) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        items,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          duration: 1,
          delay,
          stagger,
          ease: EASE_OUT,
          scrollTrigger: {
            trigger: el,
            start: "top 85%",
            toggleActions: "play none none none",
          },
        }
      );
    });
    return () => ctx.revert();
  }, [stagger, delay]);

  return ref;
}

export function GsapStaggerGroup({
  children,
  className,
  stagger = 0.12,
  delay = 0.2,
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
