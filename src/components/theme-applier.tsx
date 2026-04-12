"use client";

import { useLayoutEffect } from "react";
import { usePreferences } from "@/hooks/use-preferences";

export function ThemeApplier() {
  const { theme } = usePreferences();

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    if (theme !== "system") {
      root.classList.add(theme);
    }
  }, [theme]);

  return null;
}
