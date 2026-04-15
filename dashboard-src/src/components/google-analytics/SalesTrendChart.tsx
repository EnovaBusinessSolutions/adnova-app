// dashboard-src/src/components/google-analytics/SalesTrendChart.tsx
import React, { useMemo, useState, useEffect } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Brush,
} from "recharts";
import { Card } from "@/components/ui/card";
import { useGAOverview } from "@/hooks/useGAOverview";

/** Puntos que llegan desde la página (derivados del backend /sales trend) */
export type TrendPoint = {
  date: string;            // puede venir como YYYYMMDD o YYYY-MM-DD
  revenue: number;         // dinero
  aov: number;             // dinero (si no existe en trend real, puede venir 0)
  conversionRate: number;  // 0–1 (si no existe en trend real, puede venir 0)
};

type Props = {
  points: TrendPoint[];
  loading?: boolean;
  /** Si lo pasas por props, tiene prioridad sobre lo que detectemos del hook */
  currencyCode?: string;
  height?: number;
};

/* =========================
 * Helpers ultra-robustos
 * ========================= */
function safeCurrency(code: any) {
  const c = String(code || "MXN").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return "MXN";
  return c;
}

function normalizeDateKey(raw: any): string {
  const s = String(raw || "").trim();
  if (!s) return "";

  // GA suele devolver YYYYMMDD
  if (/^\d{8}$/.test(s)) {
    const y = s.slice(0, 4);
    const m = s.slice(4, 6);
    const d = s.slice(6, 8);
    return `${y}-${m}-${d}`;
  }

  // YYYY-MM-DD...
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // fallback: intentar parsear como Date
  const t = Date.parse(s);
  if (Number.isFinite(t)) {
    const dt = new Date(t);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  return s;
}

function useFormatters(currency: string) {
  const ccy = safeCurrency(currency);

  const money = (() => {
    try {
      return new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: ccy,
        maximumFractionDigits: 0,
      });
    } catch {
      return new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN",
        maximumFractionDigits: 0,
      });
    }
  })();

  const short = (n: number) => {
    if (!Number.isFinite(n)) return "—";
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(2)}k`;
    return Math.round(n).toString();
  };

  const date = (iso: string) => {
    const s = normalizeDateKey(iso);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    return dt.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
  };

  return { money, short, date, currency: ccy };
}

/* ======= TOOLTIP ======= */
const SalesTooltip: React.FC<{
  active?: boolean;
  label?: string;
  payload?: any[];
  showRevenue: boolean;
  showAOV: boolean;
  showRate: boolean;
  currency: string;
  formatLabel: (s: string) => string;
}> = ({ active, label, payload, showRevenue, showAOV, showRate, currency, formatLabel }) => {
  if (!active || !payload?.length) return null;

  const row = payload[0]?.payload ?? {};
  const ccy = safeCurrency(currency);

  let money: Intl.NumberFormat;
  try {
    money = new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: ccy,
      maximumFractionDigits: 0,
    });
  } catch {
    money = new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      maximumFractionDigits: 0,
    });
  }

  const safePct = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <div className="rounded-xl border border-border bg-card/90 px-3 py-2 shadow-lg">
      <div className="text-xs text-muted-foreground mb-1">
        {formatLabel(String(label || row?.dateKey || ""))}
      </div>

      {showRevenue && (
        <div className="text-sm flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#B55CFF" }} />
          <span className="opacity-70">Ingresos:</span>
          <strong>{money.format(Number(row.revenue || 0))}</strong>
        </div>
      )}

      {showAOV && (
        <div className="text-sm flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#A78BFA" }} />
          <span className="opacity-70">AOV:</span>
          <strong>{money.format(Number(row.aov || 0))}</strong>
        </div>
      )}

      {showRate && (
        <div className="text-sm flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "#60A5FA" }} />
          <span className="opacity-70">Tasa de compra:</span>
          <strong>{safePct(row.conversionPct).toFixed(2)}%</strong>
        </div>
      )}
    </div>
  );
};

/* ======= CHART ======= */
const SalesTrendChart: React.FC<Props> = ({
  points,
  loading = false,
  currencyCode,
  height = 340,
}) => {
  // Nota: este hook se usa solo como fallback para moneda si no mandas currencyCode.
  const state: any = useGAOverview() as any;
  const dataState: any = state?.data ?? state ?? {};

  const resolvedCurrency =
    safeCurrency(
      currencyCode ||
      state?.currency ||
      dataState?.currency ||
      dataState?.kpis?.currency ||
      dataState?.kpis?.currencyCode ||
      dataState?.kpis?.currency_code ||
      "MXN"
    );

  const { short, date: fmtDate, currency } = useFormatters(resolvedCurrency);

  const data = useMemo(() => {
    return (points || [])
      .map((p) => {
        const dateKey = normalizeDateKey(p.date);
        const revenue = Number(p.revenue || 0);
        const aov = Number(p.aov || 0);
        const conversionRate = Number(p.conversionRate || 0); // 0-1
        return {
          ...p,
          dateKey,
          revenue,
          aov,
          conversionRate,
          conversionPct: (Number.isFinite(conversionRate) ? conversionRate : 0) * 100,
        };
      })
      .filter((r) => !!r.dateKey);
  }, [points]);

  // Auto-toggles: si no hay datos reales, apaga series
  const hasAOV = useMemo(() => data.some((d) => Math.abs(d.aov) > 0.0001), [data]);
  const hasRate = useMemo(() => data.some((d) => Math.abs(d.conversionRate) > 0.000001), [data]);

  const [showRevenue, setShowRevenue] = useState(true);
  const [showAOV, setShowAOV] = useState(true);
  const [showRate, setShowRate] = useState(true);

  useEffect(() => {
    // si no hay AOV/Rate reales, apagarlos para que no confundan
    if (!hasAOV) setShowAOV(false);
    if (!hasRate) setShowRate(false);
  }, [hasAOV, hasRate]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-4 animate-pulse" style={{ height }}>
        <div className="h-6 w-48 bg-muted rounded mb-4" />
        <div className="h-[calc(100%-2rem)] w-full bg-muted rounded" />
      </div>
    );
  }

  if (!data.length) {
    return (
      <div
        className="rounded-xl border border-border bg-card/60 p-8 text-center text-sm text-muted-foreground"
        style={{ height }}
      >
        No hay datos suficientes para mostrar la tendencia.
      </div>
    );
  }

  const chip = (on: boolean, colorOn: string) =>
    `px-3 py-1 rounded-full text-xs font-medium transition border ${
      on
        ? `${colorOn} bg-white/5`
        : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10"
    }`;

  return (
    <Card className="rounded-2xl bg-card border border-border p-4">
      {/* Controles tipo chips */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-sm mr-1 text-white/80">Tendencia</span>

        <button
          onClick={() => setShowRevenue((v) => !v)}
          className={chip(showRevenue, "text-[#E9D5FF] border-[#B55CFF]/40")}
          style={{ boxShadow: showRevenue ? "0 0 0 1px #B55CFF33 inset" : undefined }}
        >
          Ingresos
        </button>

        <button
          onClick={() => setShowAOV((v) => !v)}
          disabled={!hasAOV}
          className={chip(showAOV && hasAOV, "text-[#EDE9FE] border-[#A78BFA]/40")}
          style={{
            boxShadow: showAOV && hasAOV ? "0 0 0 1px #A78BFA33 inset" : undefined,
            opacity: hasAOV ? 1 : 0.45,
            cursor: hasAOV ? "pointer" : "not-allowed",
          }}
          title={hasAOV ? "Mostrar/ocultar AOV" : "AOV no disponible en la serie (falta purchases por día)."}
        >
          AOV
        </button>

        <button
          onClick={() => setShowRate((v) => !v)}
          disabled={!hasRate}
          className={chip(showRate && hasRate, "text-[#DBEAFE] border-[#60A5FA]/40")}
          style={{
            boxShadow: showRate && hasRate ? "0 0 0 1px #60A5FA33 inset" : undefined,
            opacity: hasRate ? 1 : 0.45,
            cursor: hasRate ? "pointer" : "not-allowed",
          }}
          title={hasRate ? "Mostrar/ocultar tasa" : "Tasa no disponible en la serie (falta purchases por día)."}
        >
          Tasa de compra (%)
        </button>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#B55CFF" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#B55CFF" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradAov" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#A78BFA" stopOpacity={0.30} />
              <stop offset="100%" stopColor="#A78BFA" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />

          <XAxis
            dataKey="dateKey"
            tickFormatter={fmtDate}
            tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
            axisLine={{ stroke: "rgba(255,255,255,0.15)" }}
            tickLine={{ stroke: "rgba(255,255,255,0.15)" }}
            minTickGap={24}
          />

          {/* Eje izq: dinero */}
          <YAxis
            yAxisId="money"
            tickFormatter={(v) => short(Number(v) || 0)}
            tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
            axisLine={{ stroke: "rgba(255,255,255,0.15)" }}
            tickLine={{ stroke: "rgba(255,255,255,0.15)" }}
            width={70}
          />

          {/* Eje der: porcentaje */}
          <YAxis
            yAxisId="pct"
            orientation="right"
            tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
            tick={{ fill: showRate && hasRate ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.25)", fontSize: 12 }}
            axisLine={{ stroke: "rgba(255,255,255,0.15)" }}
            tickLine={{ stroke: "rgba(255,255,255,0.15)" }}
            width={50}
            hide={!(showRate && hasRate)}
            domain={[0, "auto"]}
          />

          <Tooltip
            content={
              <SalesTooltip
                showRevenue={showRevenue}
                showAOV={showAOV && hasAOV}
                showRate={showRate && hasRate}
                currency={currency}
                formatLabel={fmtDate}
              />
            }
            cursor={{ stroke: "rgba(181,92,255,0.35)", strokeWidth: 1 }}
          />

          {showRevenue && (
            <Area
              yAxisId="money"
              type="monotone"
              dataKey="revenue"
              stroke="#B55CFF"
              strokeWidth={2}
              fill="url(#gradRev)"
              dot={false}
              activeDot={{ r: 4 }}
              name="Ingresos"
            />
          )}

          {showAOV && hasAOV && (
            <Area
              yAxisId="money"
              type="monotone"
              dataKey="aov"
              stroke="#A78BFA"
              strokeWidth={2}
              fill="url(#gradAov)"
              dot={false}
              activeDot={{ r: 3 }}
              name="AOV"
            />
          )}

          {showRate && hasRate && (
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="conversionPct"
              stroke="#60A5FA"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              name="Tasa de compra"
            />
          )}

          <Brush
            dataKey="dateKey"
            height={24}
            stroke="#B55CFF"
            travellerWidth={10}
            tickFormatter={fmtDate}
            fill="rgba(255,255,255,0.04)"
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="mt-2 text-xs text-muted-foreground">
        Valores en {currency}. (Si AOV o Tasa aparecen desactivados es porque tu serie no trae purchases diarios todavía.)
      </div>
    </Card>
  );
};

export default SalesTrendChart;
