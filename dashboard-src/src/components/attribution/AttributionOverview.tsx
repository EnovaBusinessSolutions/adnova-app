import { useMemo } from "react";
import { BarChart3, PieChart as PieChartIcon } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AttributionPanel } from "@/components/attribution/AttributionPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, formatNumber } from "@/lib/attribution";
import type { AnalyticsDashboardResponse } from "@/types/attribution";

type AttributionOverviewProps = {
  data?: AnalyticsDashboardResponse | null;
  loading?: boolean;
};

const PIE_COLORS = ["#CA8AE5", "#7EF0C8", "#F3C77A", "#6A82FF", "#FF8A80", "#22D3EE", "#A78BFA", "#60A5FA"];

function formatRoas(value?: number | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(2)}x` : "-";
}

function buildRoasComparison(data?: AnalyticsDashboardResponse | null) {
  const paidMedia = data?.paidMedia || {};
  const channels = data?.channels || {};

  return ["meta", "google", "tiktok"]
    .map((platform) => {
      const revenue = Number((channels as Record<string, { revenue?: number }>)[platform]?.revenue || 0);
      const source = (paidMedia as Record<string, { spend?: number | null; revenue?: number | null; roas?: number | null } | undefined>)[platform];
      const spend = Number(source?.spend || 0);
      const nativeRevenue = Number(source?.revenue || 0);
      const adrayRoas = spend > 0 ? revenue / spend : 0;
      const nativeRoas = Number.isFinite(Number(source?.roas))
        ? Number(source?.roas || 0)
        : spend > 0
          ? nativeRevenue / spend
          : 0;

      return {
        label: platform.charAt(0).toUpperCase() + platform.slice(1),
        adrayRoas: Number(adrayRoas.toFixed(2)),
        nativeRoas: Number(nativeRoas.toFixed(2)),
      };
    })
    .filter((entry) => entry.adrayRoas > 0 || entry.nativeRoas > 0);
}

function buildAttributedOrders(data?: AnalyticsDashboardResponse | null) {
  return Object.entries(data?.channels || {})
    .map(([label, metric]) => ({
      label,
      value: Number(metric?.orders || 0),
      revenue: Number(metric?.revenue || 0),
    }))
    .filter((entry) => entry.value > 0)
    .sort((left, right) => right.value - left.value);
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; name?: string; payload?: { revenue?: number } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0C0A13]/95 px-3 py-2 text-sm text-white shadow-[0_20px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl">
      {label ? <p className="font-medium text-white">{label}</p> : null}
      <div className="mt-2 space-y-1 text-xs text-white/70">
        {payload.map((entry) => (
          <div key={`${entry.name}-${entry.value}`} className="flex items-center justify-between gap-6">
            <span>{entry.name}</span>
            <span className="font-medium text-white">{typeof entry.value === "number" ? entry.value.toFixed(2) : entry.value ?? "-"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; payload?: { revenue?: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0C0A13]/95 px-3 py-2 text-sm text-white shadow-[0_20px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl">
      <p className="font-medium text-white">{item.name}</p>
      <div className="mt-2 space-y-1 text-xs text-white/70">
        <div className="flex items-center justify-between gap-6">
          <span>Orders</span>
          <span className="font-medium text-white">{formatNumber(item.value)}</span>
        </div>
        <div className="flex items-center justify-between gap-6">
          <span>Revenue</span>
          <span className="font-medium text-white">{formatMoney(item.payload?.revenue, "MXN")}</span>
        </div>
      </div>
    </div>
  );
}

export function AttributionOverview({ data, loading }: AttributionOverviewProps) {
  const roasData = useMemo(() => buildRoasComparison(data), [data]);
  const orderData = useMemo(() => buildAttributedOrders(data), [data]);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <AttributionPanel
        title="ROAS Comparison (AdNova vs Native)"
        kicker="Commercial"
        subtitle="Compare Adray-attributed ROAS against the platform-side ROAS for the paid channels."
        actions={
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/65">
            <BarChart3 className="h-4 w-4 text-[#D2A7FF]" />
            Model comparison
          </div>
        }
        className="legacy-chart-panel"
        bodyClassName="pt-4"
      >
        <div className="legacy-chart-shell">
          {loading ? (
            <Skeleton className="h-full w-full rounded-[22px] bg-white/6" />
          ) : roasData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={roasData} barGap={12}>
                <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "rgba(225,216,243,0.7)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "rgba(225,216,243,0.55)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <RechartsTooltip content={<ChartTooltip />} />
                <Bar dataKey="adrayRoas" name="AdRay ROAS" fill="#CA8AE5" radius={[4, 4, 0, 0]} />
                <Bar dataKey="nativeRoas" name="Platform ROAS" fill="#7EF0C8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-white/[0.03] text-sm text-white/55">
              No paid media ROAS comparison is available yet.
            </div>
          )}
        </div>
      </AttributionPanel>

      <AttributionPanel
        title="Attributed Orders"
        kicker="Distribution"
        subtitle="Channel share for attributed orders, matching the previous dashboard presentation."
        actions={
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/65">
            <PieChartIcon className="h-4 w-4 text-[#7EF0C8]" />
            Channel mix
          </div>
        }
        className="legacy-chart-panel"
        bodyClassName="pt-4"
      >
        <div className="flex h-full items-center justify-between gap-6">
          <div className="legacy-chart-shell w-2/3">
            {loading ? (
              <Skeleton className="h-full w-full rounded-[22px] bg-white/6" />
            ) : orderData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={orderData}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="62%"
                    outerRadius="88%"
                    paddingAngle={2}
                  >
                    {orderData.map((entry, index) => (
                      <Cell key={`${entry.label}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip content={<DonutTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-white/[0.03] text-sm text-white/55">
                No attributed orders are available for this range.
              </div>
            )}
          </div>

          <div className="legacy-donut-legend w-1/3 space-y-3 pr-1">
            {orderData.length ? (
              orderData.map((entry, index) => (
                <div key={entry.label} className="flex items-start gap-3 rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3">
                  <span
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{entry.label}</p>
                    <p className="mt-1 text-xs text-white/58">{formatNumber(entry.value)} orders</p>
                    <p className="mt-1 text-xs text-white/48">{formatMoney(entry.revenue, "MXN")}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-white/45">No channel data</p>
            )}
          </div>
        </div>
      </AttributionPanel>
    </div>
  );
}
