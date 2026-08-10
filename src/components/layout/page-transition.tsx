"use client";

import { usePathname } from "next/navigation";

/**
 * Wraps route content in a subtle fade/slide on navigation. Keyed by pathname so React
 * remounts (and re-triggers the enter animation) on every route change. `tw-animate-css`
 * (already a dependency for Dialog/Sheet) supplies the animate-in utilities, so this adds
 * no new dependency. `motion-safe:` respects prefers-reduced-motion.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div
      key={pathname}
      className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 motion-safe:ease-out"
    >
      {children}
    </div>
  );
}
