"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { STARTERS } from "@/lib/vaarta/starters";

/**
 * The panel beside the sign-in form: the actual worlds you would walk into.
 *
 * Draws straight from `STARTERS` so the panel can never drift from what the
 * dashboard offers, and every frame is a real screen from a real journey
 * rather than marketing art.
 */
const INTERVAL_MS = 5000;
const CROSSFADE_S = 0.6;

export function LoginShowcase({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const slide = STARTERS[index % STARTERS.length];

  useEffect(() => {
    for (const starter of STARTERS) {
      const img = new window.Image();
      img.src = starter.cover;
    }
  }, []);

  useEffect(() => {
    if (reduceMotion || STARTERS.length <= 1) return;
    const id = window.setInterval(() => {
      setIndex((current) => (current + 1) % STARTERS.length);
    }, INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  return (
    <div className={`relative overflow-hidden bg-ink ${className ?? ""}`}>
      <AnimatePresence mode="sync">
        <motion.div
          key={slide.cover}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : CROSSFADE_S, ease: "easeInOut" }}
          className="absolute inset-0"
        >
          <Image
            src={slide.cover}
            alt=""
            fill
            priority={index === 0}
            unoptimized
            sizes="(max-width: 1024px) 100vw, 60vw"
            className={
              reduceMotion
                ? "object-cover object-center"
                : "animate-kenburns-subtle object-cover object-center"
            }
          />
        </motion.div>
      </AnimatePresence>

      <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-ink/85 via-ink/10 to-transparent" />

      {/* Name the place, so the panel reads as a world rather than wallpaper. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-6 lg:p-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={slide.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: reduceMotion ? 0 : 0.4 }}
          >
            <p className="font-display text-2xl font-extrabold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,.7)] lg:text-3xl">
              {slide.title}
            </p>
            <p className="mt-1 max-w-md text-sm font-semibold text-white/80 drop-shadow-[0_2px_10px_rgba(0,0,0,.7)]">
              {slide.blurb}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
