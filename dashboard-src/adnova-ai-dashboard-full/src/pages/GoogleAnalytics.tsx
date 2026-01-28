// dashboard-src/src/pages/GoogleAnalytics.tsx
import React, { useMemo, useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";

import GoogleAnalyticsHeader from "@/components/google-analytics/GoogleAnalyticsHeader";
import GoogleAnalyticsKPICards from "@/components/google-analytics/GoogleAnalyticsKPICards";

import { GoogleAnalyticsLandingPagesTable } from "@/components/google-analytics/GoogleAnalyticsLandingPagesTable";
import GoogleAnalyticsAcquisitionChart from "@/components/google-analytics/GoogleAnalyticsAcquisitionChart";
import GoogleAnalyticsConversionFunnel from "@/components/google-analytics/GoogleAnalyticsConversionFunnel";

import SalesTrendChart from "@/components/google-analytics/SalesTrendChart";
import LeadsTrendChart from "@/components/google-analytics/LeadsTrendChart";
import EngagementTrendChart from "@/components/google-analytics/EngagementTrendChart";

import { Card, CardContent } from "@/components/ui/card";

// ✅ ÚNICA fuente de datos (E2E)
import { useGAOverview } from "@/hooks/useGAOverview";

// Para currency (desde metadata de GA4)
import useGAProperties from "@/hooks/useGAProperties";

// ✅ Estado canónico de integraciones + card de desconexión
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import DisconnectedIntegrationCard from "@/components/DisconnectedIntegrationCard";

/* ---------- helpers ---------- */
function unwrapValue(v: any) {
  if (v && typeof v === "object" && "value" in v) return (v as any).value;
  return v;
}
function toNum(v: any) {
  const raw = unwrapValue(v);
  const n = typeof raw === "string" ? Number(raw) : raw;
  return Number.isFinite(n) ? n : 0;
}
function normGADate(s: any) {
  const str = String(s || "");
  if (/^\d{8}$/.test(str)) return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
  return str;
}

/** ✅ Hook local: detecta móvil (<= md) */
function useIsMobile(breakpointPx = 768) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const update = () => setIsMobile(mq.matches);

    update();
    try {
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    } catch {
      mq.addListener(update);
      return () => mq.removeListener(update);
    }
  }, [breakpointPx]);

  return isMobile;
}

const GoogleAnalytics: React.FC = () => {
  const isMobile = useIsMobile(768);

  // ✅ Anti-flicker guard (canónico)
  const { ready, connected } = useOnboardingStatus();
  const isConnected = ready && connected.ga4;

  const {
    data: overviewRaw,
    objective,
    property,
    loading: loadingOverview,
    error: errorOverview,
    date_preset,
    includeToday,
  } = useGAOverview() as any;

  // ✅ Blindaje E2E (payload plano vs {ok,data})
  const overview = useMemo(() => {
    if (overviewRaw && typeof overviewRaw === "object" && "data" in overviewRaw) {
      return (overviewRaw as any).data;
    }
    return overviewRaw;
  }, [overviewRaw]);

  // Currency desde GA properties
  const { items: gaPropsItems } = useGAProperties();
  const currencyCode = useMemo(() => {
    const meta = gaPropsItems?.find((p: any) => p?.id === property || p?.propertyId === property);
    return (meta?.currencyCode || "MXN") as string;
  }, [gaPropsItems, property]);

  const loading = !!loadingOverview;
  const anyError = errorOverview || null;

  const Section: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="grid gap-6">{children}</div>
  );

  const Empty: React.FC<{ msg?: string }> = ({ msg }) => (
    <Card className="bg-card/40">
      <CardContent className="p-6 text-sm text-muted-foreground">
        {msg || "Selecciona una propiedad de GA4 para ver métricas."}
      </CardContent>
    </Card>
  );

  // =========================================================
  // ✅ Funnel (ventas) - fetch dedicado (endpoint /funnel)
  // Reglas:
  // - No corre si no está conectado
  // - No corre en móvil (no mostramos funnel)
  // =========================================================
  const [funnel, setFunnel] = useState<any>(null);
  const [funnelPrev, setFunnelPrev] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    async function run() {
      if (!isConnected || isMobile || !property || objective !== "ventas") {
        setFunnel(null);
        setFunnelPrev(null);
        return;
      }

      try {
        const qs = new URLSearchParams();
        qs.set("property", property);
        if (date_preset) qs.set("date_preset", String(date_preset));
        qs.set("include_today", includeToday ? "1" : "0");

        const r = await fetch(`/api/google/analytics/funnel?${qs.toString()}`, {
          credentials: "include",
          signal: ac.signal,
        });

        const json = await r.json().catch(() => null);
        if (!r.ok || json?.ok === false) throw new Error(json?.error || `HTTP ${r.status}`);

        const payload = json?.data ?? json;

        if (cancelled) return;
        setFunnel(payload?.funnel || null);
        setFunnelPrev(null);
      } catch {
        if (cancelled || ac.signal.aborted) return;
        setFunnel(null);
        setFunnelPrev(null);
      }
    }

    run();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [isConnected, isMobile, property, objective, date_preset, includeToday]);

  // =========================================================
  // Series (derivadas de overview.trend) — desktop
  // =========================================================
  const salesTrend = useMemo(() => {
    const t = (overview?.trend ?? []) as any[];
    return t.map((p) => ({
      date: normGADate(p.date),
      revenue: toNum(p.revenue),
      aov: toNum(p.aov),
      conversionRate: toNum(p.conversionRate),
    }));
  }, [overview?.trend]);

  const leadsTrend = useMemo(() => {
    const t = (overview?.trend ?? []) as any[];
    return t.map((p) => ({
      date: normGADate(p.date),
      leads: toNum(p.leads),
      conversionRate: toNum(p.conversionRate),
    }));
  }, [overview?.trend]);

  const engagementTrend = useMemo(() => {
    const t = (overview?.trend ?? []) as any[];
    return t.map((p) => ({
      ...p,
      date: normGADate(p.date),
    }));
  }, [overview?.trend]);

  const revenueForFunnel = useMemo(() => {
    return toNum(overview?.revenue ?? overview?.kpis?.revenue);
  }, [overview]);

  // =========================
  // Render
  // =========================
  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        {/* ✅ Anti-flicker total (canónico) */}
        {!ready ? (
          <Card className="bg-card/40">
            <CardContent className="p-6 text-sm text-muted-foreground">
              Verificando integraciones…
            </CardContent>
          </Card>
        ) : !connected.ga4 ? (
          <DisconnectedIntegrationCard platform="ga4" />
        ) : (
          <>
            <div className="-mx-4 md:-mx-6">
             <GoogleAnalyticsHeader />
             </div>


            {/* ✅ KPIs siempre visibles (móvil y desktop) */}
            <GoogleAnalyticsKPICards />

            {/* Error */}
            {!loading && anyError && <Empty msg={`Error al cargar métricas: ${String(anyError)}`} />}

            {/* Sin property seleccionada */}
            {!property && !loading && !anyError && <Empty />}

            {/* ✅ Desktop: charts/tablas/funnel */}
            {!isMobile && property && !anyError && (
              <>
                {objective === "ventas" && (
                  <Section>
                    <Card className="h-[380px] overflow-hidden">
                      <CardContent className="h-full p-4">
                        <SalesTrendChart
                          points={salesTrend}
                          loading={loading}
                          currencyCode={currencyCode}
                        />
                      </CardContent>
                    </Card>

                    <GoogleAnalyticsConversionFunnel
                      raw={{ ...(funnel || {}), revenue: revenueForFunnel }}
                      prev={
                        funnelPrev
                          ? {
                              view_item: funnelPrev?.view_item,
                              purchase: funnelPrev?.purchase,
                              revenue: funnelPrev?.revenue,
                            }
                          : undefined
                      }
                      currencyCode={currencyCode}
                    />
                  </Section>
                )}

                {objective === "leads" && (
                  <Section>
                    <Card className="h-[360px] overflow-hidden">
                      <CardContent className="h-full p-4">
                        <LeadsTrendChart points={leadsTrend} />
                      </CardContent>
                    </Card>
                  </Section>
                )}

                {objective === "adquisicion" && (
                  <Section>
                    <GoogleAnalyticsAcquisitionChart
                      channels={overview?.channels || {}}
                      loading={loading}
                      error={anyError}
                    />
                  </Section>
                )}

                {objective === "engagement" && (
                  <Section>
                    <Card className="h-[360px] overflow-hidden">
                      <CardContent className="h-full p-4">
                        <EngagementTrendChart points={engagementTrend} />
                      </CardContent>
                    </Card>

                    <GoogleAnalyticsLandingPagesTable />
                  </Section>
                )}
              </>
            )}

            {/* ✅ Nota móvil para evitar “¿dónde están las gráficas?” */}
            {isMobile && property && !loading && !anyError && (
              <div className="text-[11px] text-muted-foreground/80">
                En móvil mostramos solo KPIs para una lectura rápida. Para ver gráficas, abre en escritorio.
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default GoogleAnalytics;
