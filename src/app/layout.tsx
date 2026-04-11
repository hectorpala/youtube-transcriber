import { Suspense } from "react";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "@/components/app-sidebar";
import { Topbar } from "@/components/topbar";
import { SummaryProvider } from "@/contexts/summary-context";
import { ErrorBoundary } from "@/components/error-boundary";
import { Skeleton } from "@/components/ui/skeleton";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Director — Trading Dashboard",
  description: "Panel de monitoreo del bot de trading",
};

function PageFallback() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[300px] rounded-xl" />
    </div>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <TooltipProvider>
          <SummaryProvider>
            <SidebarProvider>
              <AppSidebar />
              <div className="flex flex-1 flex-col">
                <Topbar />
                <main className="flex-1 overflow-auto p-6">
                  <ErrorBoundary>
                    <Suspense fallback={<PageFallback />}>
                      {children}
                    </Suspense>
                  </ErrorBoundary>
                </main>
              </div>
            </SidebarProvider>
          </SummaryProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
