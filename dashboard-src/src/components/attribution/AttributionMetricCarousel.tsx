import {
  BarChart3,
  Boxes,
  CheckCircle2,
  Eye,
  MousePointerClick,
  Percent,
  ShoppingCart,
  Unlink2,
  Users,
  Wallet,
} from "lucide-react";

import { formatMoney, formatNumber, formatPercent } from "@/lib/attribution";
import type { AnalyticsDashboardResponse } from "@/types/attribution";

type AttributionMetricCarouselProps = {
  data?: AnalyticsDashboardResponse | null;
  loading?: boolean;
};

type MetricItem = {
  label: string;
  value: string;
  accent: string;
  icon: typeof Wallet;
  helper?: string;
};

function formatRoas(value?: number | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(2)}x` : "-";
}

export function AttributionMetricCarousel({
  data,
  loading,
}: AttributionMetricCarouselProps) {
  const summary = data?.summary;
  const paidMedia = data?.paidMedia;

  const metrics: MetricItem[] = [
    {
      label: "Revenue",
      value: formatMoney(summary?.totalRevenue, "MXN"),
      accent: "bg-indigo-500",
      icon: Wallet,
      helper: `${formatNumber(summary?.purchaseOrders)} orders`,
    },
    {
      label: "Total Orders",
      value: formatNumber(summary?.totalOrders),
      accent: "bg-teal-500",
      icon: Boxes,
      helper: `${formatMoney(summary?.totalRevenue, "MXN")} total`,
    },
    {
      label: "Attributed Orders",
      value: formatNumber(summary?.attributedOrders),
      accent: "bg-green-500",
      icon: ShoppingCart,
      helper: `${formatMoney(summary?.attributedRevenue, "MXN")} attributed`,
    },
    {
      label: "Sessions",
      value: formatNumber(summary?.totalSessions),
      accent: "bg-sky-500",
      icon: Users,
      helper: `${formatPercent(summary?.conversionRate, 1)} conversion`,
    },
    {
      label: "Conversion Rate",
      value: formatPercent(summary?.conversionRate, 1),
      accent: "bg-cyan-600",
      icon: Percent,
      helper: `${formatNumber(summary?.purchaseOrders)} purchase orders`,
    },
    {
      label: "Page Views",
      value: formatNumber(summary?.pageViews),
      accent: "bg-blue-500",
      icon: Eye,
      helper: `${formatNumber(summary?.totalEvents)} total events`,
    },
    {
      label: "Add To Cart",
      value: formatNumber(summary?.addToCart),
      accent: "bg-violet-500",
      icon: MousePointerClick,
      helper: `${formatNumber(summary?.beginCheckout)} begin checkout`,
    },
    {
      label: "Purchase Events",
      value: formatNumber(summary?.purchaseEvents || summary?.purchaseEventsRaw),
      accent: "bg-emerald-600",
      icon: CheckCircle2,
      helper: `${formatNumber(summary?.purchaseOrders)} order sync`,
    },
    {
      label: "Unattributed Orders",
      value: formatNumber(summary?.unattributedOrders),
      accent: "bg-rose-500",
      icon: Unlink2,
      helper: `${formatMoney(summary?.unattributedRevenue, "MXN")} unattributed`,
    },
    {
      label: `Meta ROAS (${formatMoney(paidMedia?.meta?.spend, "MXN")} spend)`,
      value: formatRoas(paidMedia?.meta?.roas),
      accent: "bg-[#1877F2]",
      icon: BarChart3,
      helper: `${formatMoney(paidMedia?.meta?.revenue, "MXN")} revenue`,
    },
    {
      label: `Google ROAS (${formatMoney(paidMedia?.google?.spend, "MXN")} spend)`,
      value: formatRoas(paidMedia?.google?.roas),
      accent: "bg-[#EA4335]",
      icon: BarChart3,
      helper: `${formatMoney(paidMedia?.google?.revenue, "MXN")} revenue`,
    },
  ];

  return (
    <section className="space-y-3">
      <div className="dashboard-section-heading flex items-center justify-between">
        <div>
          <p className="panel-kicker">Core KPI</p>
          <h3 className="panel-title text-lg font-medium">Key Metrics</h3>
        </div>
      </div>

      <div className="metric-carousel-viewport legacy-scrollbar">
        <div className="metric-carousel-track">
          {metrics.map((metric) => {
            const Icon = metric.icon;

            return (
              <div key={metric.label} className="metric-card-slide">
                <div className="metric-card">
                  <div className="p-5">
                    <div className="flex items-center">
                      <div className={`metric-card-accent flex-shrink-0 rounded-md p-3 ${metric.accent}`}>
                        <Icon className="h-5 w-5 text-white" />
                      </div>
                      <div className="ml-5 min-w-0 flex-1">
                        <dl>
                          <dt className="truncate text-sm font-medium text-white/55">{metric.label}</dt>
                          <dd className="mt-1 text-2xl font-semibold text-white">
                            {loading ? "..." : metric.value}
                          </dd>
                        </dl>
                      </div>
                    </div>
                    <p className="mt-4 text-sm text-white/58">{loading ? "Loading..." : metric.helper}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
