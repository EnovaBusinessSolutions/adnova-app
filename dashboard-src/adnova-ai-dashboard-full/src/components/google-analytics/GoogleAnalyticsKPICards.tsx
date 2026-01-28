import React, { useMemo } from "react";
import { useGAOverview } from "@/hooks/useGAOverview";
import useGAProperties from "@/hooks/useGAProperties";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

/* ---------- helpers ---------- */
function unwrapValue(v: any) {
  if (v && typeof v === "object" && "value" in v) return (v as any).value;
  return v;
}

function toNum(v: any): number {
  const raw = unwrapValue(v);
  const n = typeof raw === "string" ? Number(raw) : (raw as number);
  return Number.isFinite(n) ? n : 0;
}

function fmtNumber(v?: any) {
  return new Intl.NumberFormat().format(toNum(v));
}

function fmtPercent(v?: any) {
  // Espera ratio 0–1 (como GA4 engagementRate / conversionRate)
  return `${(toNum(v) * 100).toFixed(1)}%`;
}

function safeCurrency(code: any) {
  const c = String(code || "MXN").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return "MXN";
  return c;
}

function buildMoneyFormatter(currency: string) {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: 0, // consistente con tus capturas
    });
  } catch {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 0,
    });
  }
}

export const GoogleAnalyticsKPICards: React.FC = () => {
  const state = useGAOverview() as any;
  const { items: gaPropsItems } = useGAProperties();

  const loading: boolean = !!state?.loading;
  const error: string | null = state?.error ?? null;

  const objective: string = state?.objective ?? "ventas";
  const property: string = state?.property ?? "";

  // ✅ Normalización extra (por si llega wrapper o internal):
  // - Nuevo hook: state.data = internal (data)
  // - Legacy: state.data = wrapper { ok, property, range, data }
  const raw: any = state?.data ?? {};
  const data: any = raw?.data && typeof raw.data === "object" ? raw.data : raw;

  // si un día usas /overview, ahí sí existe data.kpis
  const kpis: any = data?.kpis && typeof data.kpis === "object" ? data.kpis : data;

  const propertyMeta = useMemo(() => {
    return (gaPropsItems || []).find(
      (p: any) => p?.id === property || p?.propertyId === property
    );
  }, [gaPropsItems, property]);

  const currencyRaw =
    kpis?.currency ||
    kpis?.currencyCode ||
    data?.currency ||
    data?.currencyCode ||
    propertyMeta?.currencyCode ||
    "MXN";

  const currency = safeCurrency(currencyRaw);
  const moneyFmt = useMemo(() => buildMoneyFormatter(currency), [currency]);
  const fmtCurrency = (v?: any) => moneyFmt.format(toNum(v));

  if (!property) {
    return (
      <Card className="bg-card/40">
        <CardContent className="p-6 text-sm text-muted-foreground">
          Selecciona una propiedad de GA4 para ver métricas.
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="h-24 animate-pulse" />
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="bg-destructive/10 border-destructive/30">
        <CardContent className="p-6 text-sm text-destructive">
          Error al cargar métricas: {error}
        </CardContent>
      </Card>
    );
  }

  // ===================== VENTAS =====================
  if (objective === "ventas") {
    const revenue = kpis?.revenue;
    const purchases = kpis?.purchases;
    const aov = kpis?.aov;
    const pcr = kpis?.purchaseConversionRate ?? kpis?.purchase_conversion_rate;

    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader><CardTitle>Ingresos</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{fmtCurrency(revenue)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Órdenes</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{fmtNumber(purchases)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>AOV</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{fmtCurrency(aov)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Tasa de compra</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{fmtPercent(pcr)}</CardContent>
        </Card>
      </div>
    );
  }

  // ===================== LEADS =====================
  if (objective === "leads") {
    const leads = kpis?.leads;
    const lcr = kpis?.leadConversionRate ?? kpis?.conversionRate;

    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader><CardTitle>Leads generados</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{fmtNumber(leads)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Tasa de conversión a lead</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{fmtPercent(lcr)}</CardContent>
        </Card>
      </div>
    );
  }

  // ===================== ADQUISICIÓN =====================
  if (objective === "adquisicion") {
    const totalUsers = kpis?.totalUsers ?? kpis?.users;
    const sessions = kpis?.sessions;
    const newUsers = kpis?.newUsers;

    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader><CardTitle>Usuarios</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{fmtNumber(totalUsers)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Sesiones</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{fmtNumber(sessions)}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Usuarios nuevos</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{fmtNumber(newUsers)}</CardContent>
        </Card>
      </div>
    );
  }

  // ===================== ENGAGEMENT =====================
  const engagementRate = kpis?.engagementRate;
  const avgEngagementTime =
    kpis?.avgEngagementTime ?? kpis?.averageSessionDuration; // seconds

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardHeader><CardTitle>Engagement rate</CardTitle></CardHeader>
        <CardContent className="text-2xl font-semibold">{fmtPercent(engagementRate)}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Tiempo promedio</CardTitle></CardHeader>
        <CardContent className="text-2xl font-semibold">
          {toNum(avgEngagementTime) ? `${Math.round(toNum(avgEngagementTime) / 60)} min` : "0 min"}
        </CardContent>
      </Card>
    </div>
  );
};

export default GoogleAnalyticsKPICards;
