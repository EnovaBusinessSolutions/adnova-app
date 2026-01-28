import React, { useEffect, useMemo, useState } from "react";
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

export type SeriesPoint = {
  date: string;          // YYYY-MM-DD
  impressions?: number;
  clicks?: number;
  conversions?: number;
  conv_value?: number;   // revenue (moneda)
  cost?: number;         // moneda (no micros)
  cpc?: number;          // moneda
  ctr?: number;          // 0..1

  // Para objetivo "alcance" (si el backend lo envía):
  reach?: number;        // usuarios únicos
  frequency?: number;    // promedio por usuario

  // toleramos variantes crudas sólo por compat:
  cost_micros?: number;
  average_cpc_micros?: number;
  average_cpc?: number;
};

type Objective = "ventas" | "alcance" | "leads";

type Props = {
  data: SeriesPoint[];
  loading?: boolean;
  height?: number;
  currency?: string;
  locale?: string;
  objective?: Objective;
};

/* ======= helpers ======= */
function useFormatters(currency = "MXN", locale = "es-MX") {
  const money = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 });
  const int = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

  const short = (n: number) => {
    if (!Number.isFinite(n)) return "—";
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000)     return `${(n / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000)         return `${(n / 1_000).toFixed(2)}k`;
    return int.format(Math.round(n));
  };

  const date = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
    return dt.toLocaleDateString(locale, { day: "2-digit", month: "short" });
  };
  const dateFull = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
    return dt.toLocaleDateString(locale, { day: "2-digit", month: "long", year: "numeric" });
  };

  return { money, short, date, dateFull, int };
}

const clamp = (v: unknown, fb = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};
const microsToUnit = (v?: number) => Math.round(((v ?? 0) / 1_000_000) * 100) / 100;

/* ======= Tooltips ======= */
type TooltipGoogleProps = {
  active?: boolean;
  label?: string;
  payload?: any[];
  // switches
  showA?: boolean; showB?: boolean; showC?: boolean; showD?: boolean;
  // labels + selectors
  aLabel?: string; aKey?: string;
  bLabel?: string; bKey?: string;
  cLabel?: string; cKey?: string;
  dLabel?: string; dKey?: string;
  // formatting
  moneyKeys?: string[];
  percentKeys?: string[];
  xKeys?: string[]; // para 'x' como ROAS
  currency: string; locale: string;
};

function TooltipGoogle({
  active, label, payload,
  showA, showB, showC, showD,
  aLabel, aKey, bLabel, bKey, cLabel, cKey, dLabel, dKey,
  moneyKeys = [], percentKeys = [], xKeys = [],
  currency, locale,
}: TooltipGoogleProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  const moneyFmt = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 });
  const intFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

  const dtFull = (() => {
    try {
      if (!label) return "";
      const [y, m, d] = String(label).split("-").map(Number);
      const dt = new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
      return dt.toLocaleDateString(locale, { day: "2-digit", month: "long", year: "numeric" });
    } catch { return label || ""; }
  })();

  const format = (k?: string) => {
    if (!k) return "—";
    const v = Number(row[k]);
    if (!Number.isFinite(v)) return "—";
    if (moneyKeys.includes(k))   return moneyFmt.format(v);
    if (percentKeys.includes(k)) return `${(v * 100).toFixed(2)}%`;
    if (xKeys.includes(k))       return `${v.toFixed(2)}×`;
    // por defecto entero corto
    return intFmt.format(Math.round(v));
  };

  const block = (show: boolean, label: string, color: string, key?: string) =>
    show && key ? (
      <div className="text-sm flex items-center gap-2" key={key}>
        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
        <span className="opacity-70">{label}:</span>
        <strong>{format(key)}</strong>
      </div>
    ) : null;

  return (
    <div className="rounded-xl border border-border bg-card/90 px-3 py-2 shadow-lg">
      <div className="text-xs text-muted-foreground mb-1">{dtFull}</div>
      {block(!!showA, aLabel || "", "#8b5cf6", aKey)}
      {block(!!showB, bLabel || "", "#60a5fa", bKey)}
      {block(!!showC, cLabel || "", "#f59e0b", cKey)}
      {block(!!showD, dLabel || "", "#34d399", dKey)}
    </div>
  );
}

/* ======= Componente ======= */
export default function GoogleAdsTrendChart({
  data,
  loading = false,
  height = 360,
  currency = "MXN",
  locale = "es-MX",
  objective = "ventas",
}: Props) {
  const { short, date } = useFormatters(currency, locale);

  // Normaliza/deriva por día y añade métricas necesarias (roas/cpl)
  const cooked = useMemo(() => {
    const map = new Map<string, SeriesPoint>();
    (data ?? []).forEach((raw) => {
      const keyDate = String(raw.date || "").slice(0, 10);
      if (!keyDate) return;

      const impressions = clamp(raw.impressions);
      const clicks      = clamp(raw.clicks);
      const conversions = clamp(raw.conversions);
      const conv_value  = clamp(raw.conv_value);
      const cost =
        Number.isFinite(raw.cost) ? Number(raw.cost)
        : Number.isFinite(raw.cost_micros) ? microsToUnit(raw.cost_micros)
        : 0;

      const cpc =
        Number.isFinite(raw.cpc) ? Number(raw.cpc)
        : Number.isFinite(raw.average_cpc) ? Number(raw.average_cpc)
        : Number.isFinite(raw.average_cpc_micros) ? microsToUnit(raw.average_cpc_micros)
        : (clicks > 0 ? cost / clicks : 0);

      const ctrRaw = Number(raw.ctr);
      const ctr = Number.isFinite(ctrRaw)
        ? (ctrRaw > 1 ? ctrRaw / 100 : ctrRaw)
        : (impressions > 0 ? clicks / impressions : 0);

      // derivados por día:
      const roas = cost > 0 ? conv_value / cost : 0;
      const cpl  = conversions > 0 ? cost / conversions : 0;

      map.set(keyDate, {
        date: keyDate,
        impressions,
        clicks,
        conversions,
        conv_value,
        cost,
        cpc,
        ctr,
        // alcance (si backend lo trae):
        reach: Number.isFinite(raw.reach) ? Number(raw.reach) : undefined,
        frequency: Number.isFinite(raw.frequency) ? Number(raw.frequency) : undefined,
        // derivados:
        // @ts-ignore - añadimos para el chart aunque no estén tipados en la serie original
        roas,
        // @ts-ignore
        cpl,
      } as any);
    });

    return Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [data]);

  // Límite eje % (para CTR / CVR)
  const ctrMax = useMemo(() => {
    const m = Math.max(0, ...cooked.map((r: any) => Number.isFinite(r.ctr) ? (r.ctr as number) : 0));
    const padded = Math.min(Math.max(0.05, m * 1.15), 0.4);
    return Number.isFinite(padded) ? padded : 0.1;
  }, [cooked]);

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-4 animate-pulse" style={{ height }}>
        <div className="h-6 w-40 bg-muted rounded mb-4" />
        <div className="h-[calc(100%-2rem)] w-full bg-muted rounded" />
      </div>
    );
  }

  if (!cooked.length) {
    return (
      <div
        className="rounded-xl border border-border bg-card/60 p-8 text-center text-sm text-muted-foreground"
        style={{ height }}
      >
        No hay datos suficientes para mostrar la tendencia.
      </div>
    );
  }

  // Configuración por objetivo (chips + series + tooltips)
  type Chip = { key: string; label: string; y: "count" | "money" | "percent" | "x"; type?: "area" | "line"; color: string; gradId?: string; };
  let chips: Chip[] = [];

  if (objective === "ventas") {
    chips = [
      { key: "conv_value", label: "Ingresos", y: "money", type: "area", color: "#8b5cf6", gradId: "gradRevenue" },
      { key: "cost",       label: "Gasto",    y: "money", type: "area", color: "#60a5fa", gradId: "gradCost" },
      { key: "roas",       label: "ROAS",     y: "x",     type: "line", color: "#f59e0b" },
    ];
  } else if (objective === "alcance") {
    chips = [
      { key: "impressions", label: "Impresiones", y: "count", type: "area", color: "#8b5cf6", gradId: "gradImp" },
      { key: "reach",       label: "Alcance",     y: "count", type: "area", color: "#60a5fa", gradId: "gradReach" },
      { key: "frequency",   label: "Frecuencia",  y: "x",     type: "line", color: "#f59e0b" },
    ];
  } else { // leads
    chips = [
      { key: "conversions", label: "Leads",  y: "count",  type: "area", color: "#8b5cf6", gradId: "gradLeads" },
      { key: "cpl",         label: "CPL",    y: "money",  type: "line", color: "#34d399" },
      { key: "ctr",         label: "CTR",    y: "percent",type: "line", color: "#f59e0b" },
      { key: "cost",        label: "Gasto",  y: "money",  type: "area", color: "#60a5fa", gradId: "gradCost" },
    ];
  }

  // switches default: todos activos (puedes recordar estado si quieres)
  const [active, setActive] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const next: Record<string, boolean> = {};
    chips.forEach(c => { next[c.key] = true; });
    setActive(next);
  }, [objective]); // resetea al cambiar objetivo

  const toggle = (k: string) => setActive(s => ({ ...s, [k]: !s[k] }));

  // Ejes
  const showPercent = chips.some(c => c.y === "percent" && active[c.key]);
  const showMoney   = chips.some(c => c.y === "money"   && active[c.key]);

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      {/* Chips por objetivo */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="mr-2 text-sm text-white/80">Tendencia</span>
        {chips.map(c => (
          <button
            key={c.key}
            onClick={() => toggle(c.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              active[c.key]
                ? "bg-white/10 text-white border border-white/20"
                : "bg-white/5 text-white/70 border border-white/10"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={cooked} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.30} />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.30} />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradImp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.30} />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradReach" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.30} />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradLeads" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.30} />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />

          <XAxis
            dataKey="date"
            tickFormatter={date}
            tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
            axisLine={{ stroke: "rgba(255,255,255,0.15)" }}
            tickLine={{ stroke: "rgba(255,255,255,0.15)" }}
            minTickGap={24}
          />

          <YAxis
            yAxisId="count"
            tickFormatter={(v) => short(Number(v) || 0)}
            tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
            axisLine={{ stroke: "rgba(255,255,255,0.15)" }}
            tickLine={{ stroke: "rgba(255,255,255,0.15)" }}
            width={70}
          />
          <YAxis
            yAxisId="percent"
            orientation="right"
            domain={[0, ctrMax]}
            tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
            tick={{ fill: showPercent ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.25)", fontSize: 12 }}
            axisLine={{ stroke: "rgba(255,255,255,0.15)" }}
            tickLine={{ stroke: "rgba(255,255,255,0.15)" }}
            width={50}
            hide={!showPercent}
          />
          <YAxis yAxisId="money" hide={!showMoney} />

          <Tooltip
            content={
              <TooltipGoogle
                // mostramos hasta 4 series
                showA={!!active[chips[0]?.key]}
                showB={!!active[chips[1]?.key]}
                showC={!!active[chips[2]?.key]}
                showD={!!active[chips[3]?.key]}
                aLabel={chips[0]?.label} aKey={chips[0]?.key}
                bLabel={chips[1]?.label} bKey={chips[1]?.key}
                cLabel={chips[2]?.label} cKey={chips[2]?.key}
                dLabel={chips[3]?.label} dKey={chips[3]?.key}
                moneyKeys={chips.filter(c=>c.y==="money").map(c=>c.key)}
                percentKeys={chips.filter(c=>c.y==="percent").map(c=>c.key)}
                xKeys={chips.filter(c=>c.y==="x").map(c=>c.key)}
                currency={currency}
                locale={locale}
              />
            }
            cursor={{ stroke: "rgba(129,140,248,0.35)", strokeWidth: 1 }}
            labelFormatter={(d) => String(d)}
          />

          {/* Render dinámico por chip */}
          {chips.map((c) => {
            if (!active[c.key]) return null;
            const yAxis = c.y === "money" ? "money" : c.y === "percent" ? "percent" : (c.y === "x" ? "percent" : "count");
            if (c.type === "line") {
              return (
                <Line
                  key={c.key}
                  yAxisId={yAxis}
                  type="monotone"
                  dataKey={c.key}
                  stroke={c.color}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  name={c.label}
                />
              );
            }
            return (
              <Area
                key={c.key}
                yAxisId={yAxis}
                type="monotone"
                dataKey={c.key}
                stroke={c.color}
                strokeWidth={2}
                fill={`url(#${c.gradId || "gradImp"})`}
                dot={false}
                activeDot={{ r: 3 }}
                name={c.label}
              />
            );
          })}

          <Brush dataKey="date" height={24} stroke="#A78BFA" travellerWidth={10} tickFormatter={date} fill="rgba(255,255,255,0.04)" />
        </AreaChart>
      </ResponsiveContainer>

      <div className="mt-2 text-xs text-muted-foreground">
        {objective === "ventas" && "Ingresos y Gasto en moneda; ROAS en eje derecho (x)."}
        {objective === "alcance" && "Impresiones y Alcance en conteo; Frecuencia en eje derecho (x)."}
        {objective === "leads"   && "Leads en conteo; CPL y Gasto en moneda; CTR en eje derecho (%)."}
        {" "}Activa/desactiva series para comparar.
      </div>
    </div>
  );
}
