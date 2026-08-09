"use client";

import { useState } from "react";
import { Menu } from "lucide-react";

import { AppNavLinks, type AppNavVisibility } from "@/components/layout/app-sidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export function AppMobileNav(props: AppNavVisibility) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open navigation menu" className="md:hidden">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="p-0">
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <SheetTitle>Redrob ATS</SheetTitle>
          <SheetDescription>Main navigation</SheetDescription>
        </div>
        <AppNavLinks {...props} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
