"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { HelpCircle, KeyRound, LogOut, Moon, Sun, UserRound } from "lucide-react";
import { useTheme } from "next-themes";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOnboarding } from "@/components/onboarding/onboarding-provider";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function AppTopbar({
  name,
  email,
  roleNames,
  mobileNav,
}: {
  name: string;
  email: string;
  roleNames: string[];
  mobileNav?: React.ReactNode;
}) {
  const { theme, setTheme } = useTheme();
  const { startTour } = useOnboarding();

  return (
    <header className="flex h-14 items-center justify-between border-b px-4">
      <div>{mobileNav}</div>
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle theme"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <Sun className="dark:hidden" />
              <Moon className="hidden dark:block" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle theme</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 gap-2 px-2" data-tour="user-menu">
              <Avatar className="size-7">
                <AvatarFallback>{initials(name)}</AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium sm:inline">{name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-1">
                <span className="truncate font-medium text-foreground">{name}</span>
                <span className="truncate font-normal text-muted-foreground">{email}</span>
                {roleNames.length > 0 ? (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {roleNames.map((roleName) => (
                      <Badge key={roleName} variant="secondary" className="font-normal">
                        {roleName}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile">
                <UserRound /> My profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/profile/password">
                <KeyRound /> Change password
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={startTour}>
              <HelpCircle /> Replay tour
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => signOut({ callbackUrl: "/login" })}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
