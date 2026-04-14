// dashboard-src/src/components/google-analytics/LeadsTrendChart.tsx
import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  YAxis,
  XAxis,
  Tooltip,
  CartesianGrid,
  Brush,
} from "recharts";
import type { LeadPoint } from "@/hooks/useGALeads";
import { Card } from "@/components/ui/card";

type Props = {
  points?: LeadPoint[];
  loading?: boolean;
  height?: number;
};

const nfInt = new Intl.NumberFormat("es-MX");

export default function LeadsTrendChart({
  points = [],
  loading = false,
  height = 360,
}: Props) {
  const [showLeads, setShowLeads] = useState(true);
  const [showRate, setShowRate] = useState(true);

  // Datos normalizados (rate en % para el eje derecho)
  const data = useMemo(
    () =>
      (points ?? []).map((p) => ({
        ...p,
        ratePct: (Number(p.conversionRate) || 0) * 100,
        leads: Number(p.leads) || 0,
      })),
    [points]
  );

  // Dominios agradables a la vista
  const { maxLeads, maxRate } = useMemo(() => {
    let ml = 0;
    let mr = 0;
    for (const d of data) {
      ml = Math.max(ml, d.leads || 0);
      mr = Math.max(mr, d.ratePct || 0);
    }
    return { maxLeads: ml, maxRate: mr };
  }, [data]);

  const countDomain: [number, number] = [0, maxLeads > 0 ? Math.ceil(maxLeads * 1.1) : 1];
  const pctDomain: [number, number] = [0, maxRate > 0 ? Math.ceil(maxRate * 1.15) : 5];

  const pill = "px-3 py-1.5 text-sm rounded-full border transition active:scale-[.98]";
  const on = "bg-primary/15 border-primary/40 text-foreground";
  const off = "bg-muted border-[hsl(var(--border))] text-muted-foreground";

  // Skeleton
  if (loading) {
    return (
      <Card className="rounded-2xl bg-card border border-border p-4">
        <div className="h-6 w-32 bg-muted rounded mb-3" />
        <div className="h-[300px] w-full bg-muted/60 rounded" />
      </Card>
    );
  }

  // Empty state
  if (!data.length) {
    return (
      <Card className="rounded-2xl bg-card border border-border p-6 text-sm text-muted-foreground">
        No hay datos suficientes para mostrar la tendencia de leads.
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl bg-card border border-border p-4">
      {/* Toggles */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm mr-1 text-white/80">Tendencia</span>
        <button
          className={`${pill} ${showLeads ? on : off}`}
          onClick={() => setShowLeads((v) => !v)}
          aria-pressed={showLeads}
        >
          • Leads
        </button>
        <button
          className={`${pill} ${showRate ? on : off}`}
          onClick={() => setShowRate((v) => !v)}
          aria-pressed={showRate}
        >
          • Conversión a lead (%)
        </button>
      </div>

      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 10, right: 18, bottom: 6, left: 0 }}
          >
            <CartesianGrid
              stroke="hsl(var(--muted-foreground)/0.08)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              minTickGap={24}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
            />
            {/* Eje izquierdo: conteo */}
            <YAxis
              yAxisId="count"
              width={60}
              tickLine={false}
              axisLine={false}
              domain={countDomain}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              tickFormatter={(v) => nfInt.format(Math.round(Number(v) || 0))}
            />
            {/* Eje derecho: porcentaje */}
            <YAxis
              yAxisId="pct"
              orientation="right"
              width={50}
              tickLine={false}
              axisLine={false}
              domain={pctDomain}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              tickFormatter={(v) => `${Math.round(Number(v) || 0)}%`}
            />

            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 12,
              }}
              formatter={(val: any, name: string) => {
                if (name === "ratePct") return [`${(+val).toFixed(2)}%`, "Conversión a lead"];
                return [nfInt.format(Math.round(+val || 0)), "Leads"];
              }}
              labelFormatter={(lab) => String(lab)}
              cursor={{ stroke: "hsl(var(--primary) / 0.35)", strokeWidth: 1 }}
            />

            {showLeads && (
              <Line
                yAxisId="count"
                type="monotone"
                dataKey="leads"
                name="Leads"
                stroke="hsl(var(--primary))"
                strokeWidth={2.4}
                dot={false}
                activeDot={{ r: 4 }}
              />
            )}
            {showRate && (
              <Line
                yAxisId="pct"
                type="monotone"
                dataKey="ratePct"
                name="Conversión a lead"
                stroke="hsl(200 90% 65%)" // azul para % (consistente con ventas)
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            )}

            <Brush
              dataKey="date"
              height={24}
              stroke="hsl(var(--primary))"
              travellerWidth={10}
              tickFormatter={(v) => String(v)}
              className="mt-1"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        Conteo a la izquierda; porcentaje a la derecha. Activa/desactiva series para comparar.
      </div>
    </Card>
  );
}
