import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Same rationale as tests/ui-audit-fixes.test.ts: these are pure
 * client-component/asset wiring changes (a logo swap, theme tokens, an
 * onboarding tour) with no service-layer counterpart to exercise against a
 * real database. Reading the actual source/asset and asserting the specific
 * markers this feature introduced is a real, if lightweight, guard against
 * someone reverting the wiring later.
 */
function readSrc(relativePath: string): string {
  return readFileSync(join(process.cwd(), "src", relativePath), "utf8");
}

describe("Redrob logo rebrand", () => {
  it("the uploaded logo asset exists at the two paths the app serves it from", () => {
    expect(existsSync(join(process.cwd(), "public", "logo.png"))).toBe(true);
    expect(existsSync(join(process.cwd(), "src", "app", "icon.png"))).toBe(true);
  });

  it("the Logo component renders the shared asset via next/image", () => {
    const source = readSrc("components/brand/logo.tsx");
    expect(source).toContain('from "next/image"');
    expect(source).toContain('src="/logo.png"');
  });

  it.each([
    "components/layout/app-sidebar.tsx",
    "components/layout/app-mobile-nav.tsx",
    "app/login/page.tsx",
  ])("%s renders the Logo component instead of text-only branding", (path) => {
    const source = readSrc(path);
    expect(source).toContain('from "@/components/brand/logo"');
    expect(source).toContain("<Logo");
  });
});

describe("Brand theme tokens", () => {
  it("globals.css defines a chromatic brand primary (no longer an achromatic grayscale palette)", () => {
    const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("\n}\n"));
    expect(rootBlock).toMatch(/--primary:\s*oklch\(0\.45\s+0\.19\s+264\)/);
  });
});

describe("First-time onboarding tour", () => {
  it("the tour steps builder filters nav-item steps by the same visibility flags the sidebar uses", () => {
    const source = readSrc("components/onboarding/tour-steps.ts");
    expect(source).toContain("nav.showJobsNav");
    expect(source).toContain("nav.showCandidatesNav");
    expect(source).toContain("nav.adminNavVisibility");
  });

  it("the overlay exposes Skip, Back, Next, and Finish controls and persists completion", () => {
    const source = readSrc("components/onboarding/onboarding-tour-overlay.tsx");
    expect(source).toMatch(/>\s*Skip\s*</);
    expect(source).toMatch(/>\s*Back\s*</);
    expect(source).toMatch(/>\s*Next\s*</);
    expect(source).toMatch(/>\s*Finish\s*</);
    expect(source).toContain('fetch("/api/account/onboarding"');
  });

  it("the (app) layout wraps the shell in OnboardingProvider, keyed off the persisted onboardingCompletedAt column", () => {
    const source = readSrc("app/(app)/layout.tsx");
    expect(source).toContain("OnboardingProvider");
    expect(source).toContain("onboardingCompletedAt");
    expect(source).toContain("buildOnboardingSteps(navVisibility)");
  });

  it("the topbar user menu offers a way to replay the tour on demand", () => {
    const source = readSrc("components/layout/app-topbar.tsx");
    expect(source).toContain("useOnboarding");
    expect(source).toContain("startTour");
    expect(source).toContain("Replay tour");
  });

  it("nav links carry a data-tour marker the tour can target", () => {
    const source = readSrc("components/layout/app-sidebar.tsx");
    expect(source).toMatch(/data-tour=\{`nav-\$\{item\.href\}`\}/);
  });
});
