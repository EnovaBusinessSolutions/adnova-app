import { Badge } from "@/components/ui/badge";
import { AttributionPanel } from "@/components/attribution/AttributionPanel";
import { formatMoney } from "@/lib/attribution";
import type { AnalyticsDashboardResponse, PaidMediaSource } from "@/types/attribution";

type AttributionPaidMediaPanelProps = {
  data?: AnalyticsDashboardResponse | null;
};

function formatRoas(value?: number | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(2)}x` : "-";
}

function sourceStatus(source?: PaidMediaSource | null) {
  if (!source) return "Disconnected";
  if (source.connectedResourceName || source.connectedResourceId) return source.hasSnapshot ? "API active" : "Connected";
  if (source.hasSnapshot) return "Snapshot ready";
  return "Disconnected";
}

function platformCard(label: string, source?: PaidMediaSource | null) {
  return {
    label,
    status: sourceStatus(source),
    spend: formatMoney(source?.spend, "MXN"),
    revenue: formatMoney(source?.revenue, "MXN"),
    roas: formatRoas(source?.roas),
    account: source?.connectedResourceName || source?.connectedResourceId || "-",
    campaign: "-",
    sync: source?.hasSnapshot ? "Recent snapshot available" : "No live data yet",
  };
}

export function AttributionPaidMediaPanel({
  data,
}: AttributionPaidMediaPanelProps) {
  const paidMedia = data?.paidMedia;
  const cards = [
    platformCard("Meta Ads", paidMedia?.meta),
    platformCard("Google Ads", paidMedia?.google),
  ];
  const linked = Boolean(paidMedia?.linked);

  return (
    <AttributionPanel
      title="Paid Media"
      kicker="Investment"
      subtitle="Compare spend, revenue, and ROAS to decide whether traffic is justifying the investment."
      actions={
        <Badge className="border-white/10 bg-white/[0.05] px-3 py-1.5 text-white/72">
          {linked ? "Connected" : "Not connected"}
        </Badge>
      }
      className="support-shell"
      bodyClassName="pt-4"
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <div key={card.label} className="legacy-support-card p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-white/45">{card.label}</div>
            <div className="mt-2 text-lg font-semibold text-white">{card.status}</div>
            <div className="mt-1 text-sm text-white/58">Spend: <span className="text-white/72">{card.spend}</span></div>
            <div className="mt-1 text-sm text-white/58">Revenue: <span className="text-white/72">{card.revenue}</span></div>
            <div className="mt-1 text-sm text-white/58">ROAS: <span className="text-white/72">{card.roas}</span></div>
            <div className="mt-1 text-xs text-white/50">Connected account: <span className="font-medium text-white/72">{card.account}</span></div>
            <div className="mt-1 text-xs text-white/50">Primary campaign: <span className="font-medium text-white/72">{card.campaign}</span></div>
            <div className="mt-2 text-xs text-white/40">{card.sync}</div>
          </div>
        ))}
      </div>
    </AttributionPanel>
  );
}
