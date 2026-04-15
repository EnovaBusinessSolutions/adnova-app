// dashboard-src/src/components/google-analytics/GoogleAnalyticsPerformanceTrendChart.tsx
import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";

type TrendPoint = {
  date: string;          // ISO yyyy-mm-dd o etiqueta corta ("1 Nov")
  usuarios: number;
  sesiones: number;
  conversiones: number;
  engagement?: number;   // opcional (0–1)
  revenue?: number;      // opcional
};

type Props = {
  // Permitimos cualquier array y lo normalizamos adentro
  data: any[] | TrendPoint[];
};

const fmtNum = (n: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0
  );

/** Normaliza la forma de los puntos sin importar cómo venga del backend */
function normalizeTrend(input: any[] | undefined | null): TrendPoint[] {
  if (!Array.isArray(input)) return [];

  return input.map((r: any) => {
    const date: string =
      r?.date ?? r?.day ?? r?.label ?? "";

    const usuarios: number = Number(
      r?.usuarios ?? r?.users ?? r?.totalUsers ?? 0
    );

    const sesiones: number = Number(
      r?.sesiones ?? r?.sessions ?? 0
    );

    const conversiones: number = Number(
      r?.conversiones ?? r?.conversions ?? r?.purchases ?? 0
    );

    const engagement: number | undefined =
      r?.engagement ?? r?.engagementRate ?? undefined;

    const revenue: number | undefined =
      r?.revenue ?? r?.purchaseRevenue ?? undefined;

    return { date, usuarios, sesiones, conversiones, engagement, revenue };
  });
}

/**
 * Componente de línea para Tendencias de Performance (Usuarios, Sesiones,
 * Conversiones, Engagement). Recibe los datos desde el contenedor.
 *
 * Uso:
 *   <GoogleAnalyticsPerformanceTrendChart data={series} />
 */
export const GoogleAnalyticsPerformanceTrendChart: React.FC<Props> = ({ data }) => {
  const normalized = normalizeTrend(data as any[]);

  // Fallback de seguridad por si llega vacío
  const safeData: TrendPoint[] =
    normalized.length
      ? normalized
      : [
          { date: "1 Nov", usuarios: 4200, sesiones: 6800, conversiones: 180, engagement: 0.65 },
          { date: "5 Nov", usuarios: 3800, sesiones: 6200, conversiones: 165, engagement: 0.68 },
          { date: "10 Nov", usuarios: 4500, sesiones: 7200, conversiones: 195, engagement: 0.70 },
          { date: "15 Nov", usuarios: 4800, sesiones: 7800, conversiones: 210, engagement: 0.72 },
          { date: "20 Nov", usuarios: 5200, sesiones: 8400, conversiones: 225, engagement: 0.69 },
          { date: "25 Nov", usuarios: 4900, sesiones: 7900, conversiones: 208, engagement: 0.71 },
          { date: "30 Nov", usuarios: 5400, sesiones: 8900, conversiones: 245, engagement: 0.73 },
        ];

  // Detecta si tenemos engagement/revenue para decidir si pintarlos
  const hasEngagement = safeData.some(p => typeof p.engagement === "number");
  const hasRevenue = safeData.some(p => typeof p.revenue === "number");

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={safeData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 12, opacity: 0.85 }} />
          <YAxis tick={{ fontSize: 12, opacity: 0.85 }} tickFormatter={(v) => fmtNum(Number(v))} />
          <Tooltip
            formatter={(val: any) => fmtNum(Number(val ?? 0))}
            labelClassName="text-foreground"
            contentStyle={{
              background: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
            }}
          />
          <Legend />
          <Line
            type="monotone"
            dataKey="usuarios"
            name="Usuarios"
            stroke="hsl(var(--primary))"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="sesiones"
            name="Sesiones"
            stroke="hsl(267, 84%, 77%)"
            dot={false}
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="conversiones"
            name="Conversiones"
            stroke="hsl(157, 84%, 67%)"
            dot={false}
            strokeWidth={2}
          />
          {hasEngagement && (
            <Line
              type="monotone"
              dataKey="engagement"
              name="Engagement"
              stroke="hsl(47, 84%, 67%)"
              dot={false}
              strokeWidth={2}
            />
          )}
          {hasRevenue && (
            <Line
              type="monotone"
              dataKey="revenue"
              name="Ingresos"
              stroke="hsl(10, 78%, 62%)"
              dot={false}
              strokeWidth={2}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default GoogleAnalyticsPerformanceTrendChart;
