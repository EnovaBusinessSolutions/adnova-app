import { buildSummaryCards } from "@/lib/attribution-view-models";
import type { AnalyticsDashboardResponse } from "@/types/attribution";

type AttributionSummaryCardsProps = {
  data?: AnalyticsDashboardResponse | null;
  loading?: boolean;
};

export function AttributionSummaryCards({
  data,
  loading,
}: AttributionSummaryCardsProps) {
  const cards = buildSummaryCards(data);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[#BCA6D7]">
            Core KPI
          </p>
          <h2 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-white">
            Key metrics
          </h2>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, index) => (
          <div
            key={card.label}
            className="overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(21,18,26,0.96)_0%,rgba(11,10,19,0.98)_100%)] p-5 shadow-[0_18px_48px_rgba(0,0,0,0.26)]"
          >
            <div className="flex items-center gap-4">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] ${
                  index === 0
                    ? "bg-[#B55CFF]"
                    : index === 1
                      ? "bg-[#4FE3C1]"
                      : index === 2
                        ? "bg-[#22D3EE]"
                        : "bg-[#60A5FA]"
                }`}
              >
                <span className="text-lg font-semibold text-white">{index + 1}</span>
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm text-white/55">{card.label}</p>
                <p className="mt-1 truncate text-2xl font-semibold text-white">
                  {loading ? "..." : card.value}
                </p>
              </div>
            </div>
            <p className="mt-4 text-sm text-white/58">{loading ? "Loading metrics..." : card.helper}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
