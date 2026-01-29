import React, { useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, YAxis, XAxis, Tooltip, CartesianGrid, Brush } from "recharts";
import type { EngagementPoint } from "@/hooks/useGAEngagement";
import { Card } from "@/components/ui/card";

export default function EngagementTrendChart({ points = [], height = 340 }: { points?: EngagementPoint[]; height?: number }) {
  const [showRate, setShowRate] = useState(true);
  const [showTime, setShowTime] = useState(true);

  const data = useMemo(
    () => points.map(p => ({ ...p, ratePct: (p.engagementRate || 0) * 100, timeMin: (p.avgTime || 0) / 60 })),
    [points]
  );

  const pill = "px-3 py-1.5 text-sm rounded-full border transition";
  const on   = "bg-primary/15 border-primary/40 text-foreground";
  const off  = "bg-muted border-[hsl(var(--border))] text-muted-foreground";

  return (
    <Card className="rounded-2xl bg-card border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm mr-1 text-white/80">Tendencia</span>
        <button className={`${pill} ${showTime ? on : off}`} onClick={() => setShowTime(v => !v)}>• Tiempo prom. (min)</button>
        <button className={`${pill} ${showRate ? on : off}`} onClick={() => setShowRate(v => !v)}>• Engagement rate (%)</button>
      </div>

      <div className="w-full" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke="hsl(var(--muted-foreground)/0.08)" vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
            <YAxis yAxisId="time" width={60} tickLine={false} axisLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              tickFormatter={(v) => `${Math.round(Number(v)||0)}m`} />
            <YAxis yAxisId="pct" orientation="right" width={50} tickLine={false} axisLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              tickFormatter={(v) => `${Math.round(Number(v)||0)}%`} />

            <Tooltip
              isAnimationActive={false}
              contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12 }}
              formatter={(val: any, name: string) => {
                if (name === "ratePct") return [`${(+val).toFixed(2)}%`, "Engagement rate"];
                return [`${(+val).toFixed(1)}m`, "Tiempo prom."];
              }}
              labelFormatter={(lab) => String(lab)}
            />

            {showTime && <Line yAxisId="time" type="monotone" dataKey="timeMin" name="Tiempo prom." stroke="hsl(var(--primary))" strokeWidth={2.4} dot={false} activeDot={{ r: 4 }} />}
            {showRate && <Line yAxisId="pct"  type="monotone" dataKey="ratePct" name="Engagement rate" stroke="hsl(200 90% 65%)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />}

            <Brush dataKey="date" height={24} stroke="hsl(var(--primary))" travellerWidth={10} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        Minutos a la izquierda; porcentaje a la derecha. Activa/desactiva series para comparar.
      </div>
    </Card>
  );
}
