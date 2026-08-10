"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Animates from 0 up to `value` once (on mount, or whenever `value`
 * changes), via requestAnimationFrame — no animation library needed for a
 * single number tween. Skips straight to the final value under
 * prefers-reduced-motion.
 */
export function useCountUp(value: number, durationMs = 700) {
  const [display, setDisplay] = useState(0);
  const frameRef = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(value);
      return;
    }

    const start = performance.now();

    function tick(now: number) {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(Math.round(value * eased));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, durationMs]);

  return display;
}
