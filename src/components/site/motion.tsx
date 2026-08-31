import * as React from "react";
import { motion } from "framer-motion";

/** Arcade-style ease curves (extracted from live CSS) */
export const EASE = [0.16, 1, 0.3, 1] as const;
export const EASE_HEADER = [0.25, 0.46, 0.45, 0.94] as const; // arcade header scroll
export const EASE_OUT = "easeOut" as const; // arcade WowCoolNice

/** Arcade WowCoolNice entrance: 1s ease-out, translateY -16px → 0, opacity 0 → 1.
 *  Default delay 0.6s matches arcade .anim-slidefade-speed-3. */
export function Reveal({
  children,
  delay = 0.6,
  y = 16,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: "div" | "section" | "li" | "span";
}) {
  const MotionTag = motion[as] as typeof motion.div;
  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 1, delay, ease: EASE_OUT }}
    >
      {children}
    </MotionTag>
  );
}
