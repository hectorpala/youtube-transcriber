"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Crosshair,
  History,
  ShieldAlert,
  Radio,
  ScrollText,
  FlaskConical,
} from "lucide-react";

const navItems = [
  { title: "Dashboard", href: "/", icon: LayoutDashboard },
  { title: "Posiciones", href: "/positions", icon: Crosshair },
  { title: "Trades", href: "/trades", icon: History },
  { title: "Riesgo", href: "/risk", icon: ShieldAlert },
  { title: "Señales", href: "/signals", icon: Radio },
  { title: "Estrategias", href: "/strategies", icon: FlaskConical },
  { title: "Logs", href: "/logs", icon: ScrollText },
];

/**
 * Issue #36: mode is now a prop instead of hardcoded.
 * TODO: Read from summary API/context once available at this level.
 * Default is "PAPER" to match current behavior.
 */
interface AppSidebarProps {
  mode?: string;
}

export function AppSidebar({ mode = "PAPER" }: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-profit/10 text-profit font-bold text-sm font-mono">
            D
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold text-foreground">
              Director
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">
              Sistema de Trading
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.title}
                      render={<Link href={item.href} />}
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4 group-data-[collapsible=icon]:hidden">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-profit animate-pulse" />
          <span className="text-xs text-muted-foreground font-mono">
            MODO {mode.toUpperCase()}
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
