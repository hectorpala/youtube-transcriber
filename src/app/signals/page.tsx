import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Radio } from "lucide-react";

export default function SignalsPage() {
  return (
    <>
      <PageHeader
        title="Señales / Shadow Log"
        description="Todas las señales generadas: ejecutadas, rechazadas y shadow"
      />

      <div className="mb-4">
        <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning font-mono text-xs">
          Próximamente
        </Badge>
      </div>

      {/* Signal action breakdown - skeleton-like placeholders */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        {[
          { label: "Ejecutadas", color: "text-profit", badge: "border-profit/50 bg-profit/10 text-profit" },
          { label: "Shadow", color: "text-info", badge: "border-info/50 bg-info/10 text-info" },
          { label: "Rechazadas (Riesgo)", color: "text-loss", badge: "border-loss/50 bg-loss/10 text-loss" },
          { label: "Rechazadas (Régimen)", color: "text-warning", badge: "border-warning/50 bg-warning/10 text-warning" },
        ].map((item) => (
          <Card key={item.label} className="bg-card border-border">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <Badge variant="outline" className={`${item.badge} font-mono text-xs`}>
                  <Skeleton className="h-3 w-6" />
                </Badge>
              </div>
              <div className="mt-2">
                <Skeleton className="h-7 w-16" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Feed de Señales
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col h-[400px] items-center justify-center gap-4">
            <div className="h-14 w-14 rounded-full bg-secondary flex items-center justify-center">
              <Radio className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Feed de señales en tiempo real
              </p>
              <p className="text-xs text-muted-foreground/60 font-mono mt-1">
                Datos desde director_shadow.json — próxima fase
              </p>
            </div>
            {/* Skeleton rows to hint at future content */}
            <div className="w-full max-w-md space-y-2 mt-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
