"use client";

import { Search, ArrowUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";

export type SortKey = "default" | "price" | "change" | "volume";

const sortLabels: Record<SortKey, string> = {
  default: "Default",
  price: "Precio",
  change: "% Cambio",
  volume: "Volumen",
};

const sortOrder: SortKey[] = ["default", "price", "change", "volume"];

interface GridToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  sortKey: SortKey;
  onSortChange: (key: SortKey) => void;
}

export function GridToolbar({ search, onSearchChange, sortKey, onSortChange }: GridToolbarProps) {
  const cycleSort = () => {
    const next = sortOrder[(sortOrder.indexOf(sortKey) + 1) % sortOrder.length];
    onSortChange(next);
  };

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Buscar moneda..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-8 pl-8 text-xs"
        />
      </div>
      <button
        onClick={cycleSort}
        className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <ArrowUpDown className="h-3.5 w-3.5" />
        {sortLabels[sortKey]}
      </button>
    </div>
  );
}
