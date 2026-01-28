import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useGALandingPages } from "@/hooks/useGALandingPages";

function fmtInt(n?: number) {
  return Number.isFinite(n as number) ? (n as number).toLocaleString() : "0";
}
function fmtPct(n?: number) {
  if (!Number.isFinite(n as number)) return "0%";
  return `${(((n as number) ?? 0) * 100).toFixed(1)}%`;
}

export const GoogleAnalyticsLandingPagesTable: React.FC = () => {
  const { rows, loading, error, property } = useGALandingPages();

  return (
    <Card className="glass-effect">
      <CardHeader>
        <CardTitle className="text-foreground">Páginas de Aterrizaje</CardTitle>
        <CardDescription>Performance de las principales páginas de entrada</CardDescription>
      </CardHeader>

      <CardContent>
        {!property && (
          <div className="text-sm text-muted-foreground">
            Selecciona una propiedad de GA4 para ver métricas.
          </div>
        )}

        {property && loading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 w-full animate-pulse rounded-md bg-muted/50" />
            ))}
          </div>
        )}

        {property && !loading && error && (
          <div className="text-sm text-destructive">No se pudieron cargar las páginas: {error}</div>
        )}

        {property && !loading && !error && (!rows || rows.length === 0) && (
          <div className="text-sm text-muted-foreground">Sin datos para el rango seleccionado.</div>
        )}

        {property && !loading && !error && rows && rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-muted-foreground">Página</TableHead>
                <TableHead className="text-muted-foreground">Sesiones</TableHead>
                <TableHead className="text-muted-foreground">Usuarios</TableHead>
                <TableHead className="text-muted-foreground">Engagement</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, idx) => {
                const page = r.landingPage || "/"; // <-- sin r.page
                const sessions = Number(r.sessions ?? 0);
                const users = Number(r.users ?? 0);
                const engagementRate = typeof r.engagementRate === "number" ? r.engagementRate : undefined;

                return (
                  <TableRow key={`${page}-${idx}`} className="hover:bg-muted/50">
                    <TableCell className="font-medium text-foreground">{page}</TableCell>
                    <TableCell className="text-foreground">{fmtInt(sessions)}</TableCell>
                    <TableCell className="text-foreground">{fmtInt(users)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={engagementRate !== undefined && engagementRate >= 0.7 ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {fmtPct(engagementRate)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default GoogleAnalyticsLandingPagesTable;
