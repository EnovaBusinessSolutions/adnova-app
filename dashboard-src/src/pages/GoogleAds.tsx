// dashboard-src/src/pages/GoogleAds.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/DashboardLayout";

import GoogleAdsHeader from "@/components/google-ads/GoogleAdsHeader";
import GoogleAdsKPICards from "@/components/google-ads/GoogleAdsKPICards";
import GoogleAdsTrendChart, { type SeriesPoint } from "@/components/google-ads/GoogleAdsTrendChart";

import useGoogleAdsAccounts from "@/hooks/useGoogleAdsAccounts";
import { useGoogleAdsInsights, normalizeCustomerId } from "@/hooks/useGoogleAdsInsights";

import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import DisconnectedIntegrationCard from "@/components/DisconnectedIntegrationCard";

type GoogleObjective = "ventas" | "alcance" | "leads";

/** ✅ Hook local: detecta móvil (<= md) sin depender de archivos extra */
function useIsMobile(breakpointPx = 768) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${breakpointPx}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mq = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const update = () => setIsMobile(mq.matches);

    update();

    // Safari fallback
    if ((mq as any).addEventListener) (mq as any).addEventListener("change", update);
    else (mq as any).addListener(update);

    return () => {
      if ((mq as any).removeEventListener) (mq as any).removeEventListener("change", update);
      else (mq as any).removeListener(update);
    };
  }, [breakpointPx]);

  return isMobile;
}

/**
 * ✅ Start event (E2E)
 * - Solo dispara si la URL termina en "/start"
 * - Solo una vez por sesión (sessionStorage)
 */
const START_SS_KEY = "adray:start:google_ads:fired:v1";

function safeSessionGet(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSessionSet(key: string, val: string) {
  try {
    sessionStorage.setItem(key, val);
  } catch {}
}

function fireStartEvent(payload: Record<string, any>) {
  // GA4 (gtag)
  try {
    const w = window as any;
    if (typeof w.gtag === "function") {
      w.gtag("event", "integration_start", payload);
    }
  } catch {}

  // GTM (dataLayer)
  try {
    const w = window as any;
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({
      event: "integration_start",
      ...payload,
    });
  } catch {}

  // Meta Pixel (fbq) — opcional
  try {
    const w = window as any;
    if (typeof w.fbq === "function") {
      w.fbq("trackCustom", "integration_start", payload);
    }
  } catch {}
}

const GoogleAdsPage: React.FC = () => {
  const [params] = useSearchParams();
  const location = useLocation();
  const isMobile = useIsMobile(768);

  const { ready, connected } = useOnboardingStatus();
  const showDisconnected = ready && !connected.googleAds;

  // ===== Parámetros de URL =====
  const objective = useMemo<GoogleObjective>(() => {
    const raw = (params.get("objective") || "ventas").toLowerCase();
    return (["ventas", "alcance", "leads"].includes(raw) ? raw : "ventas") as GoogleObjective;
  }, [params]);

  const datePreset = useMemo(() => (params.get("date_preset") || "last_30d").toLowerCase(), [params]);
  const includeToday = useMemo(() => params.get("include_today") === "1", [params]);

  // account_id (compat con customer_id)
  const accountId = useMemo(
    () => normalizeCustomerId(params.get("account_id") || params.get("customer_id")),
    [params]
  );

  // ===== Cuentas =====
  const { loading: loadingAcc, error: errorAcc, getDisplayName } = useGoogleAdsAccounts();

  // ===== Insights =====
  const { data, loading: loadingKpis, error: errorKpis, refresh } = useGoogleAdsInsights({
    accountId,
    datePreset,
    includeToday,
    objective,
  });

  const currency = data?.currency || "MXN";
  const locale = data?.locale || "es-MX";

  const series: SeriesPoint[] = useMemo(() => {
    const s = (data as any)?.series;
    return Array.isArray(s) ? (s as SeriesPoint[]) : [];
  }, [data]);

  const kpis = data?.kpis;
  const deltas = data?.deltas || undefined;

  const accountLabel = accountId ? getDisplayName(accountId) : "—";
  const isLoading = loadingAcc || loadingKpis;
  const errCode = (errorAcc || errorKpis) ?? null;

  const hasAccountSelected = !!accountId;

  // ✅ Regla UX: en móvil NO mostramos gráficas (aunque existan datos)
  const showTrendDesktopOnly =
    !isMobile && !isLoading && !errCode && hasAccountSelected && series.length > 0;

  /**
   * ✅ DISPARAR EVENTO /start UNA SOLA VEZ
   * - Solo cuando realmente estamos en la ruta /google-ads/start
   * - Solo cuando ya hay ready (para evitar disparo en estado intermedio)
   */
  const isStartRoute = useMemo(() => {
    const p = (location.pathname || "").toLowerCase();
    return p.endsWith("/google-ads/start") || p.endsWith("/google-ads/start/");
  }, [location.pathname]);

  useEffect(() => {
    if (!isStartRoute) return;
    if (!ready) return;

    // Si está desconectado, no tiene sentido “start”
    if (!connected.googleAds) return;

    // Once per session
    if (safeSessionGet(START_SS_KEY) === "1") return;

    const payload = {
      integration: "google_ads",
      page: "google-ads",
      path: `${location.pathname}${location.search || ""}`,
      account_id: accountId || undefined, // customer id normalizado
      objective,
      date_preset: datePreset,
      include_today: includeToday ? 1 : 0,
      ts: Date.now(),
    };

    // Marca primero para evitar duplicados
    safeSessionSet(START_SS_KEY, "1");
    fireStartEvent(payload);
  }, [
    isStartRoute,
    ready,
    connected.googleAds,
    location.pathname,
    location.search,
    accountId,
    objective,
    datePreset,
    includeToday,
  ]);

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6">
        {/* ✅ Anti-flicker: antes de ready NO mostramos nada del panel */}
        {!ready ? (
          <div className="mt-6 rounded-xl border border-border/60 bg-card/40 p-6 text-sm text-muted-foreground">
            Verificando integraciones…
          </div>
        ) : showDisconnected ? (
          <DisconnectedIntegrationCard platform="googleAds" />
        ) : (
          <>
            <div className="-mx-4 md:-mx-6">
              <GoogleAdsHeader onRefresh={refresh} />
            </div>

            {/* Subinfo: compacto en móvil, completo en desktop */}
            <div className="mt-2 text-xs text-muted-foreground">
              <span className="font-medium">
                {(datePreset || "").replace(/_/g, " ")}
                {includeToday ? " (incluye hoy)" : ""}
              </span>

              <span className="mx-2 opacity-50">·</span>
              <span className="font-medium">{accountLabel}</span>

              {!isMobile && (
                <>
                  <span className="mx-2 opacity-50">·</span>
                  <span className="font-medium">{currency}</span>
                </>
              )}
            </div>

            {/* ✅ Estado: sin cuenta seleccionada */}
            {!hasAccountSelected && !loadingAcc && !isLoading && (
              <div className="mt-4 rounded-xl border p-4 text-sm text-muted-foreground">
                Selecciona una cuenta de Google Ads para ver tus KPIs.
              </div>
            )}

            {/* Error bloqueante */}
            {!!errCode && !isLoading && (
              <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 p-4">
                <div className="text-sm font-medium">Ocurrió un error al obtener los KPIs</div>
                <div className="mt-1 break-all text-xs opacity-80">{String(errCode)}</div>
                <button className="mt-3 rounded-md border px-3 py-1.5" onClick={refresh}>
                  Reintentar
                </button>
              </div>
            )}

            {/* Skeletons mientras carga (en móvil NO mostramos el bloque de gráfica) */}
            {isLoading && (
              <div className="mt-6 space-y-6">
                <div className="h-28 rounded-xl bg-muted animate-pulse" />
                {!isMobile && <div className="h-80 rounded-xl bg-muted animate-pulse" />}
              </div>
            )}

            {/* KPIs */}
            {!isLoading && !errCode && hasAccountSelected && !!kpis && (
              <div className="mt-6">
                <GoogleAdsKPICards
                  objective={objective}
                  kpis={kpis as any}
                  deltas={deltas}
                  loading={false}
                  error={null}
                  onRetry={refresh}
                  currency={currency}
                  locale={locale}
                  compareLabel={isMobile ? "vs anterior" : "vs mes anterior"}
                />
              </div>
            )}

            {/* ✅ Tendencia (SOLO desktop) */}
            {showTrendDesktopOnly && (
              <div className="mt-6">
                <GoogleAdsTrendChart
                  data={series}
                  loading={false}
                  currency={currency}
                  locale={locale}
                  height={380}
                  objective={objective}
                />
              </div>
            )}

            {/* Empty state cuando no hay datos (pero sin error) */}
            {!isLoading && !errCode && hasAccountSelected && (!kpis || series.length === 0) && (
              <div className="mt-6 rounded-xl border p-4 text-sm text-muted-foreground">
                No hay datos suficientes para el rango seleccionado.
              </div>
            )}

            {/* ✅ Nota móvil (pequeña y no estorba) */}
            {!isLoading && !errCode && hasAccountSelected && isMobile && (
              <div className="mt-4 text-[11px] text-muted-foreground/80">
                En móvil mostramos solo KPIs para una lectura rápida. Para ver gráficas, abre en escritorio.
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default GoogleAdsPage;
