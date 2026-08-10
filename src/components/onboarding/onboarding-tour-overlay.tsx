"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TourStep } from "@/components/onboarding/tour-steps";

const CARD_WIDTH = 320;
const CARD_MARGIN = 16;

function useTargetRect(selector: string | null) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }
    const update = () => {
      const el = document.querySelector(selector);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    // Cheap fallback for layout shifts a resize/scroll listener won't catch
    // (e.g. the sidebar finishing its own mount) — only runs while a tour
    // step is actually on screen.
    const intervalId = window.setInterval(update, 250);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.clearInterval(intervalId);
    };
  }, [selector]);

  return rect;
}

function computeCardStyle(rect: DOMRect): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(CARD_WIDTH, viewportWidth - CARD_MARGIN * 2);

  const left = Math.min(Math.max(rect.left, CARD_MARGIN), viewportWidth - width - CARD_MARGIN);

  const spaceBelow = viewportHeight - rect.bottom;
  const top =
    spaceBelow > 240 ? rect.bottom + 12 : Math.max(rect.top - 240, CARD_MARGIN);

  return { position: "fixed", top, left, width };
}

export function OnboardingTourOverlay({
  steps,
  onDone,
}: {
  steps: TourStep[];
  onDone: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const step = steps[index];
  const isLast = index === steps.length - 1;
  const rect = useTargetRect(step?.selector ?? null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!step?.selector) return;
    document.querySelector(step.selector)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [step]);

  const finish = useCallback(() => {
    onDone();
    fetch("/api/account/onboarding", { method: "POST" }).catch(() => {
      // Best-effort — worst case the tour reappears next session, a minor
      // inconvenience rather than a functional break.
    });
  }, [onDone]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") finish();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [finish]);

  if (!mounted || !step) return null;

  const spotlighted = rect !== null;

  return createPortal(
    <div className="fixed inset-0 z-100" role="dialog" aria-modal="true" aria-label="Product tour">
      {spotlighted ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-lg ring-2 ring-primary transition-all duration-200 motion-safe:animate-in motion-safe:fade-in"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            boxShadow: "0 0 0 9999px rgba(10,10,15,0.55)",
          }}
        />
      ) : (
        <div
          className="fixed inset-0 bg-black/50 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
          onClick={finish}
        />
      )}

      <div
        className={cn(
          "fixed rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200",
          !spotlighted && "top-1/2 left-1/2 w-[min(320px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2",
        )}
        style={spotlighted ? computeCardStyle(rect) : undefined}
      >
        <p className="text-xs font-medium text-muted-foreground">
          Step {index + 1} of {steps.length}
        </p>
        <h2 className="mt-1 text-sm font-semibold">{step.title}</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={finish}>
            Skip
          </Button>
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <Button variant="outline" size="sm" onClick={() => setIndex((current) => current - 1)}>
                Back
              </Button>
            ) : null}
            {isLast ? (
              <Button size="sm" onClick={finish}>
                Finish
              </Button>
            ) : (
              <Button size="sm" onClick={() => setIndex((current) => current + 1)}>
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
