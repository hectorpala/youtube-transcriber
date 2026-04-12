"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Sun, Moon, Monitor } from "lucide-react";
import { usePreferences } from "@/hooks/use-preferences";
import type { Preferences } from "@/lib/preferences";

const themeOrder: Preferences["theme"][] = ["system", "dark", "light"];
const themeIcons = { system: Monitor, dark: Moon, light: Sun } as const;

export function Topbar() {
  const { theme, setTheme } = usePreferences();
  const Icon = themeIcons[theme];

  const cycleTheme = () => {
    const next = themeOrder[(themeOrder.indexOf(theme) + 1) % themeOrder.length];
    setTheme(next);
  };

  return (
    <header className="flex h-12 items-center gap-4 border-b border-border bg-card/80 backdrop-blur-sm px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="h-5" />
      <span className="text-sm font-semibold text-foreground">YouTube Transcriber</span>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={cycleTheme}
          className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title={`Tema: ${theme}`}
        >
          <Icon className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
