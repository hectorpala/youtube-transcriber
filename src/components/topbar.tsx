"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export function Topbar() {
  return (
    <header className="flex h-12 items-center gap-4 border-b border-border bg-card/80 backdrop-blur-sm px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="h-5" />
      <span className="text-sm font-semibold text-foreground">Trading Dashboard</span>
    </header>
  );
}
