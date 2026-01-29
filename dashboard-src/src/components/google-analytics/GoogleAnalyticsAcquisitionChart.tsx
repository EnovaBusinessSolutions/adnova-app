// dashboard-src/src/components/google-analytics/GoogleAnalyticsAcquisitionChart.tsx
import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Sector,
} from "recharts";
import { Card } from "@/components/ui/card";

/** Props: mismas que vienes usando */
type Props = {
  channels?: Record<string, number>;
  loading?: boolean;
  error?: string | null;
  totalSessions?: number; // opcional: si lo pasas, el tooltip muestra conteos absolutos más precisos
};

const FALLBACK_COLORS = [
  "#9b87f5", // primary-like
  "#7dd3fc",
  "#fbbf24",
  "#22c55e",
  "#ef4444",
  "#14b8a6",
  "#f472b6",
];

const colorVar = (v: string, fb: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(v)?.trim() || fb;

const COLORS = [
  `hsl(var(--primary))`,
  `hsl(var(--chart-1, 200 95% 68%))`,
  `hsl(var(--chart-2, 45 95% 60%))`,
  `hsl(var(--chart-3, 150 60% 45%))`,
  `hsl(var(--chart-4, 350 85% 60%))`,
  `hsl(var(--chart-5, 180 70% 50%))`,
].map((c, i) => (c.includes("hsl(") ? c : FALLBACK_COLORS[i] || FALLBACK_COLORS[0]));

/** Agrupa categorías muy pequeñas para evitar “confeti” visual */
function groupSmall(
  items: Array<{ name: string; value: number }>,
  minPct = 0.02 // 2%
) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const small = items.filter((i) => i.value / total < minPct);
  const big = items.filter((i) => i.value / total >= minPct);
  const otherSum = small.reduce((s, i) => s + i.value, 0);
  return otherSum > 0 ? [...big, { name: "Otros", value: otherSum }] : big;
}

const DonutTooltip: React.FC<{
  active?: boolean;
  payload?: any[];
  label?: string;
  total?: number;
}> = ({ active, payload, total }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  const pct = ((p.value / (p.total || total || 1)) * 100).toFixed(1);
  const count = p.value;
  return (
    <div
      style={{
        background: "hsl(var(--popover))",
        border: "1px solid hsl(var(--border))",
        borderRadius: 12,
        padding: "10px 12px",
        color: "hsl(var(--foreground))",
        boxShadow: "0 8px 24px hsl(var(--foreground)/0.08)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.name}</div>
      <div style={{ fontSize: 13, opacity: 0.9 }}>
        <b>{pct}%</b>
        {typeof total === "number" ? (
          <>
            {" "}
            — {count.toLocaleString()} / {total.toLocaleString()}
          </>
        ) : null}
      </div>
    </div>
  );
};

/** Sector resaltado al hover (más grueso y con sombra sutil) */
const ActiveShape = (props: any) => {
  const {
    cx,
    cy,
    innerRadius,
    outerRadius,
    startAngle,
    endAngle,
    fill,
    payload,
    midAngle,
  } = props;

  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius - 2}
        outerRadius={outerRadius + 8}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        cornerRadius={10}
      />
      {/* puntito y texto arriba del segmento activo */}
      <circle
        cx={cx + Math.cos((-midAngle * Math.PI) / 180) * (outerRadius + 16)}
        cy={cy + Math.sin((-midAngle * Math.PI) / 180) * (outerRadius + 16)}
        r={4}
        fill={fill}
        opacity={0.9}
      />
    </g>
  );
};

const CenterLabel: React.FC<{
  mainName: string;
  mainPct: number;
  activeName?: string;
  activePct?: number;
}> = ({ mainName, mainPct, activeName, activePct }) => {
  const name = activeName || mainName;
  const pct = typeof activePct === "number" ? activePct : mainPct;
  return (
    <div className="absolute inset-0 grid place-items-center pointer-events-none">
      <div className="text-center">
        <div className="text-xs text-muted-foreground mb-0.5">Principal</div>
        <div className="text-lg font-semibold tracking-tight">{name}</div>
        <div className="text-sm text-muted-foreground">{pct.toFixed(1)}%</div>
      </div>
    </div>
  );
};

const pill =
  "inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm border border-[hsl(var(--border))] bg-[hsl(var(--card))]";

const GoogleAnalyticsAcquisitionChart: React.FC<Props> = ({
  channels,
  loading,
  error,
  totalSessions,
}) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const data = useMemo(() => {
    const arr = Object.entries(channels || {}).map(([name, value]) => ({
      name,
      value: Math.max(0, Number(value) || 0),
    }));
    // ordenamos por valor desc y agrupamos chicos
    const sorted = arr.sort((a, b) => b.value - a.value);
    const grouped = groupSmall(sorted, 0.02);
    const total = grouped.reduce((s, i) => s + i.value, 0) || 1;
    const withPct = grouped.map((d) => ({ ...d, pct: d.value / total, total }));
    const main = withPct[0] || { name: "—", pct: 0, value: 0, total };
    return { rows: withPct, total, main };
  }, [channels]);

  if (loading) {
    return (
      <Card className="rounded-2xl border border-border bg-card p-5 h-[380px]" />
    );
  }
  if (error) {
    return (
      <Card className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5">
        <div className="text-sm text-destructive-foreground">
          Error al cargar: {error}
        </div>
      </Card>
    );
  }

  const legend = data.rows.map((r, i) => ({
    ...r,
    color: COLORS[i % COLORS.length],
  }));

  const active = activeIndex != null ? legend[activeIndex] : null;

  return (
    <Card className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-6 mb-4">
        <div className="text-lg font-medium text-foreground">
          Canales de Adquisición
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Chart */}
        <div className="relative lg:col-span-7 xl:col-span-8 h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={legend}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={90}
                outerRadius={120}
                paddingAngle={3}
                cornerRadius={10}
                activeIndex={activeIndex ?? undefined}
                activeShape={ActiveShape}
                onMouseEnter={(_, i) => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex(null)}
                isAnimationActive={true}
                animationDuration={500}
              >
                {legend.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>

              <Tooltip
                content={
                  <DonutTooltip total={totalSessions ?? data.total} />
                }
              />
            </PieChart>
          </ResponsiveContainer>

          <CenterLabel
            mainName={data.main.name}
            mainPct={data.main.pct * 100}
            activeName={active?.name}
            activePct={active ? active.pct * 100 : undefined}
          />
        </div>

        {/* Legend */}
        <div className="lg:col-span-5 xl:col-span-4">
          <div className="space-y-2">
            {legend.map((r, i) => (
              <div
                key={r.name}
                className={`${pill} w-full justify-between`}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseLeave={() => setActiveIndex(null)}
                style={{
                  borderColor:
                    activeIndex === i
                      ? "hsl(var(--primary))"
                      : "hsl(var(--border))",
                  background:
                    activeIndex === i
                      ? "hsl(var(--primary)/0.06)"
                      : "hsl(var(--card))",
                  transition: "all .2s ease",
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: r.color }}
                  />
                  <span className="text-foreground">{r.name}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {(r.pct * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        * Piezas &lt; 2% se agrupan en “Otros”. Pasa el cursor para ver detalle.
      </div>
    </Card>
  );
};

export default GoogleAnalyticsAcquisitionChart;
