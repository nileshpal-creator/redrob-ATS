import Image from "next/image";

import { cn } from "@/lib/utils";

/** The Redrob mark. `public/logo.png` is the source-of-truth asset (also used as the app's favicon via `src/app/icon.png`). */
export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <Image
      src="/logo.png"
      alt="Redrob"
      width={size}
      height={size}
      priority
      className={cn("shrink-0 rounded-md", className)}
    />
  );
}
