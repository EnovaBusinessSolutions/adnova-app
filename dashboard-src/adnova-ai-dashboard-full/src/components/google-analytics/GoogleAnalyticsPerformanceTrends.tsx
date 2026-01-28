// dashboard-src/src/components/google-analytics/GoogleAnalyticsPerformanceTrends.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GoogleAnalyticsPerformanceTrendChart } from "./GoogleAnalyticsPerformanceTrendChart";

type ApiOverview = {
  ok: boolean;
  trend: Array<{
    date: string;          // "YYYYMMDD" o "YYYY-MM-DD"
    users: number;
    sessions: number;
    conversions: number;
    revenue: number;
    engagementRate?: number;
  }>;
};

function getProperty(): string | null {
  const sp = new URLSearchParams(window.location.search);
  const p = sp.get("property");
  if (p) { try { localStorage.setItem("ga_property", p); } catch {} return p; }
  try { return localStorage.getItem("ga_property"); } catch { return null; }
}

function getRange(): string {
  const sp = new URLSearchParams(window.location.search);
  const raw = sp.get("range") || "30";
  // Asegura que tu backend entienda estos presets (last_30_days / last_60_days / last_90_days)
  if (raw === "60") return "last_60_days";
  if (raw === "90") return "last_90_days";
  return "last_30_days";
}

export const GoogleAnalyticsPerformanceTrends: React.FC = () => {
  const property = useMemo(getProperty, []);
  const dateRange = useMemo(getRange, []);
  const [data, setData] = useState<ApiOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        if (!property) { setErr("Selecciona una propiedad de GA4 para continuar."); setLoading(false); return; }
        setLoading(true); setErr(null);
        const q = `property=${encodeURIComponent(property)}&dateRange=${encodeURIComponent(dateRange)}`;
        const res = await fetch(`/api/google/analytics/overview?${q}`);
        const json: ApiOverview = await res.json();
        if (!cancel) {
          if (!json?.ok) throw new Error("No se pudo cargar la tendencia.");
          setData(json);
        }
      } catch (e: any) {
        if (!cancel) setErr(e?.message || "Error cargando tendencia.");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [property, dateRange]);

  if (loading) {
    return (
      <Card className="glass-effect">
        <CardHeader>
          <CardTitle className="text-foreground">Tendencias de Performance</CardTitle>
          <CardDescription>Analizando datos…</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="h-5 w-56 bg-muted rounded animate-pulse" />
          <div className="h-[300px] bg-muted rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (err || !data?.trend?.length) {
    return (
      <Card className="glass-effect">
        <CardHeader>
          <CardTitle className="text-foreground">Tendencias de Performance</CardTitle>
          <CardDescription>Usuarios, sesiones, conversiones y engagement</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {err || "No hay datos suficientes para la tendencia."}
        </CardContent>
      </Card>
    );
  }

  // Adaptamos a las claves en español que espera tu chart
  const series = data.trend.map((t) => {
    // Normalizar fecha a etiqueta corta (opcional)
    const iso = t.date.includes("-")
      ? t.date
      : `${t.date.slice(0,4)}-${t.date.slice(4,6)}-${t.date.slice(6,8)}`;
    const d = new Date(iso);
    const label = isNaN(d.getTime())
      ? t.date
      : new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit" }).format(d);

    return {
      date: label,
      usuarios: Number(t.users || 0),
      sesiones: Number(t.sessions || 0),
      conversiones: Number(t.conversions || 0),
      engagement: typeof t.engagementRate === "number" ? Math.round(t.engagementRate * 100) : undefined, // % a 0-100
    };
  });

  return (
    <Card className="glass-effect hover:neon-glow transition-all duration-300">
      <CardHeader>
        <CardTitle className="text-foreground">Tendencias de Performance</CardTitle>
        <CardDescription>
          Evolución de usuarios, sesiones, conversiones y engagement
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <GoogleAnalyticsPerformanceTrendChart data={series} />
        </div>
      </CardContent>
    </Card>
  );
};

export default GoogleAnalyticsPerformanceTrends;
