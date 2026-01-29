// dashboard-src/src/pages/MetaAds.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import DashboardLayout from "@/components/DashboardLayout";
import MetaAdsHeader from "@/components/meta-ads/MetaAdsHeader";
import MetaAdsKPICards from "@/components/meta-ads/MetaAdsKPICards";
import MetaAdsTrendChart from "@/components/meta-ads/MetaAdsTrendChart";
import MetaAdsEntityTable from "@/components/meta-ads/MetaAdsEntityTable";
import { useMetaInsights, type MetaObjective } from "@/hooks/useMetaInsights";

import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import DisconnectedIntegrationCard from "@/components/DisconnectedIntegrationCard";

/** Detecta móvil (<= md o dispositivo táctil) */
function useIsMobileLike() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mqWidth = window.matchMedia("(max-width: 900px)");
    const mqCoarse = window.matchMedia("(pointer: coarse)");

    const calc = () => setIsMobile(Boolean(mqWidth.matches || mqCoarse.matches));
    calc();

    const onChange = () => calc();

    try {
      mqWidth.addEventListener("change", onChange);
      mqCoarse.addEventListener("change", onChange);
      return () => {
        mqWidth.removeEventListener("change", onChange);
        mqCoarse.removeEventListener("change", onChange);
      };
    } catch {
      mqWidth.addListener(onChange);
      mqCoarse.addListener(onChange);
      return () => {
        mqWidth.removeListener(onChange);
        mqCoarse.removeListener(onChange);
      };
    }
  }, []);

  return isMobile;
}

/** Normaliza act_123 -> 123 */
function normActId(v?: string | null) {
  if (!v) return undefined;
  return String(v).replace(/^act_/, "").trim() || undefined;
}

export default function MetaAds() {
  const isMobile = useIsMobileLike();
  const [params] = useSearchParams();

  const { ready, connected } = useOnboardingStatus();
  const showDisconnected = ready && !connected.meta;

  // ===== Params robustos =====
  const objective = useMemo<MetaObjective>(() => {
    const raw = (params.get("objective") || "ventas").toLowerCase();
    return (["ventas", "alcance", "leads"].includes(raw) ? raw : "ventas") as MetaObjective;
  }, [params]);

  const datePreset = useMemo(() => {
    const raw = (params.get("date_preset") || "last_30d").toLowerCase();
    return raw || "last_30d";
  }, [params]);

  const includeToday = useMemo(() => params.get("include_today") === "1", [params]);

  const urlLevel = useMemo(() => (params.get("level") || "account").toLowerCase(), [params]);
  const level = useMemo(() => {
    const valid = ["account", "campaign", "adset", "ad"].includes(urlLevel);
    return (valid ? urlLevel : "account") as "account" | "campaign" | "adset" | "ad";
  }, [urlLevel]);

  const day = useMemo(() => params.get("day") || undefined, [params]);

  // account_id puede venir como act_XXXX
  const accountIdParam = useMemo(() => normActId(params.get("account_id")), [params]);

  // ✅ Regla UX: en móvil SOLO KPIs
  const mobileKpisOnly = isMobile;

  // ✅ Para evitar estados raros en móvil: forzamos account-level y sin "day"
  const effectiveLevel = mobileKpisOnly ? "account" : level;
  const effectiveDay = mobileKpisOnly ? undefined : day;

  // ===== Data =====
  const { data, loading, error, refetch } = useMetaInsights({
    objective,
    datePreset,
    level: effectiveLevel,
    accountId: accountIdParam,
    includeToday,
    day: effectiveDay,
  });

  const showTrend = useMemo(() => ["ventas", "alcance", "leads"].includes(objective), [objective]);
  const currencyCode = data?.currencyCode || "MXN";

  const accountIdForTable = useMemo(() => {
    const fromUrl = accountIdParam;
    const fromData = normActId((data as any)?.account_id);
    return fromUrl || fromData || "";
  }, [accountIdParam, data]);

  const needsAccount = ready && connected.meta && !accountIdParam;

  return (
    <DashboardLayout>
      {/* ✅ IMPORTANTÍSIMO: evita overflow horizontal global en DESKTOP */}
      <div className="w-full min-w-0 overflow-x-hidden">
        {!ready ? (
          <div className="p-4 md:p-6">
            <div className="rounded-xl border border-border/60 bg-card/40 p-6 text-sm text-muted-foreground">
              Verificando integraciones…
            </div>
          </div>
        ) : showDisconnected ? (
          <div className="p-4 md:p-6">
            <DisconnectedIntegrationCard platform="meta" />
          </div>
        ) : (
          <>
            {/* ✅ Header sticky full-width del panel (SIN wrapper px extra) */}
            <MetaAdsHeader onRefresh={refetch} />

            {/* ✅ Contenido */}
            <div className="p-4 md:p-6">
              <div className={isMobile ? "space-y-4" : "mx-auto max-w-[1400px] min-w-0 space-y-6"}>
                {needsAccount && (
                  <div className="rounded-xl border border-border/60 bg-card/40 p-4 text-sm text-muted-foreground">
                    Selecciona una Ad Account para ver tus KPIs.
                  </div>
                )}

                <MetaAdsKPICards
                  objective={objective}
                  kpis={data?.kpis}
                  deltas={data?.deltas}
                  loading={loading}
                  error={error}
                  onRetry={refetch}
                  datePreset={datePreset}
                  level={effectiveLevel}
                  currencyCode={currencyCode}
                />

                {!mobileKpisOnly && (
                  <>
                    {showTrend && (
                      <div className="min-w-0 overflow-hidden">
                        <MetaAdsTrendChart
                          objective={objective}
                          data={data?.series ?? []}
                          loading={loading}
                          height={360}
                          currencyCode={currencyCode}
                        />
                      </div>
                    )}

                    {accountIdForTable && (
                      <div className="min-w-0 overflow-hidden">
                        <MetaAdsEntityTable
                          accountId={String(accountIdForTable)}
                          objective={objective as "ventas" | "alcance" | "leads"}
                          datePreset={!effectiveDay ? datePreset : undefined}
                          since={effectiveDay ? effectiveDay : undefined}
                          until={effectiveDay ? effectiveDay : undefined}
                        />
                      </div>
                    )}

                    <div className="text-xs text-white/40">
                      Cuenta: {normActId((data as any)?.account_id) ?? "—"} · Rango:{" "}
                      {effectiveDay ? `Día ${effectiveDay}` : datePreset} · Nivel: {effectiveLevel} · Divisa:{" "}
                      {currencyCode}
                    </div>
                  </>
                )}

                {mobileKpisOnly && (
                  <div className="text-[11px] text-muted-foreground/80">
                    En móvil mostramos solo KPIs para lectura rápida. Para ver gráficas y tablas, abre en escritorio.
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
