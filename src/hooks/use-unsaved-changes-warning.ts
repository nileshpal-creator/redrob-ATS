"use client";

import { useEffect } from "react";

/**
 * Warns before a full page unload (tab close, refresh, typed URL) while
 * `dirty` is true. Next.js client-side navigation (router.push) doesn't fire
 * `beforeunload`, so this only covers leaving the app entirely.
 */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);
}
