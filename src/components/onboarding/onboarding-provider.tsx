"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { OnboardingTourOverlay } from "@/components/onboarding/onboarding-tour-overlay";
import type { TourStep } from "@/components/onboarding/tour-steps";

type OnboardingContextValue = {
  /** Re-opens the tour on demand — wired to a "Replay tour" action in the topbar user menu. */
  startTour: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return context;
}

export function OnboardingProvider({
  initialCompleted,
  steps,
  children,
}: {
  initialCompleted: boolean;
  steps: TourStep[];
  children: React.ReactNode;
}) {
  const [active, setActive] = useState(() => !initialCompleted && steps.length > 0);

  const startTour = useCallback(() => setActive(true), []);
  const value = useMemo(() => ({ startTour }), [startTour]);

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {active ? <OnboardingTourOverlay steps={steps} onDone={() => setActive(false)} /> : null}
    </OnboardingContext.Provider>
  );
}
