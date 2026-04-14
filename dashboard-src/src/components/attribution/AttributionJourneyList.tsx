import { ChevronRight, Layers3 } from "lucide-react";

import { AttributionPanel } from "@/components/attribution/AttributionPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  formatMoney,
  formatTimestamp,
  getSessionIdsForPurchase,
  makePurchaseKey,
  resolveAttributionLabel,
  resolveChannelTone,
} from "@/lib/attribution";
import { cn } from "@/lib/utils";
import type { RecentPurchase } from "@/types/attribution";

type AttributionJourneyListProps = {
  purchases: RecentPurchase[];
  selectedPurchaseKey: string;
  loading?: boolean;
  fetching?: boolean;
  canLoadMore?: boolean;
  embedded?: boolean;
  className?: string;
  scrollAreaClassName?: string;
  onSelect: (purchase: RecentPurchase) => void;
  onLoadMore: () => void;
};

type JourneyListInnerProps = Pick<
  AttributionJourneyListProps,
  "purchases" | "selectedPurchaseKey" | "loading" | "fetching" | "canLoadMore" | "onSelect" | "onLoadMore"
> & {
  scrollAreaClassName?: string;
};

function JourneyListInner({
  purchases,
  selectedPurchaseKey,
  loading,
  fetching,
  canLoadMore,
  scrollAreaClassName,
  onSelect,
  onLoadMore,
}: JourneyListInnerProps) {
  return (
    <>
      <ScrollArea className={cn("h-[32rem] pr-3", scrollAreaClassName)}>
        <div className="space-y-3">
          {purchases.length ? (
            purchases.map((purchase) => {
              const purchaseKey = makePurchaseKey(purchase);
              const active = purchaseKey === selectedPurchaseKey;
              const tone = resolveChannelTone(
                purchase.attributedChannel || purchase.attributedPlatform || purchase.wooSourceLabel || "Other"
              );
              const sessionCount = getSessionIdsForPurchase(purchase).length;
              const attributionLabel = resolveAttributionLabel(purchase);

              return (
                <button
                  key={purchaseKey}
                  type="button"
                  onClick={() => onSelect(purchase)}
                  className={`group w-full rounded-[26px] border p-4 text-left transition-all ${
                    active
                      ? "border-[#B55CFF]/30 bg-[#B55CFF]/10 shadow-[0_18px_42px_rgba(181,92,255,0.18)]"
                      : "border-white/10 bg-white/[0.04] hover:border-white/16 hover:bg-white/[0.06]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-semibold tracking-[-0.03em] text-white">
                        {purchase.customerName || `Order #${purchase.orderNumber || purchase.orderId || "--"}`}
                      </h3>
                      <p className="mt-2 text-sm text-white/58">{formatTimestamp(purchase.createdAt)}</p>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-white/35 transition-transform group-hover:translate-x-0.5 group-hover:text-white/65" />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge className={`border px-3 py-1.5 ${tone.badge}`}>
                      {purchase.attributedChannel || purchase.attributedPlatform || "Other"}
                    </Badge>
                    <Badge className="border-white/10 bg-white/[0.05] px-3 py-1.5 text-white/72">
                      {formatMoney(purchase.revenue, purchase.currency || "MXN")}
                    </Badge>
                    <Badge className="border-white/10 bg-white/[0.05] px-3 py-1.5 text-white/72">
                      <Layers3 className="mr-1.5 h-3.5 w-3.5" />
                      {sessionCount} session{sessionCount === 1 ? "" : "s"}
                    </Badge>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-white/60">
                    {attributionLabel}
                  </p>
                </button>
              );
            })
          ) : (
            <div className="flex h-[16rem] items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-6 text-center text-sm leading-6 text-white/55">
              {loading
                ? "Loading stitched purchases from the analytics API."
                : "No historical conversion journeys were returned for this filter window."}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="mt-5 flex items-center justify-between gap-3 rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3">
        <p className="text-sm text-white/60">
          {fetching && purchases.length
            ? "Refreshing journeys..."
            : "Fetches more recent purchases through the shared recent_limit query parameter."}
        </p>
        {canLoadMore ? (
          <Button
            type="button"
            onClick={onLoadMore}
            className="rounded-2xl border border-[#B55CFF]/20 bg-[#B55CFF]/14 px-4 text-white hover:bg-[#B55CFF]/22"
          >
            Load More
          </Button>
        ) : null}
      </div>
    </>
  );
}

export function AttributionJourneyList({
  purchases,
  selectedPurchaseKey,
  loading,
  fetching,
  canLoadMore,
  embedded = false,
  className,
  scrollAreaClassName,
  onSelect,
  onLoadMore,
}: AttributionJourneyListProps) {
  if (embedded) {
    return (
      <div className={cn("h-full rounded-[24px] border border-white/10 bg-[rgba(71,44,28,0.36)] p-5", className)}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-white">
              Historical Conversion Journeys
            </h3>
            <p className="mt-2 text-sm leading-6 text-white/58">
              Recent stitched purchases from the shared analytics API. The first 10 render initially and the rest load on demand.
            </p>
          </div>
          <Badge className="border-white/10 bg-white/[0.05] px-3 py-1.5 text-white/70">
            {purchases.length} loaded
          </Badge>
        </div>

        <div className="mt-5">
          <JourneyListInner
            purchases={purchases}
            selectedPurchaseKey={selectedPurchaseKey}
            loading={loading}
            fetching={fetching}
            canLoadMore={canLoadMore}
            scrollAreaClassName={scrollAreaClassName}
            onSelect={onSelect}
            onLoadMore={onLoadMore}
          />
        </div>
      </div>
    );
  }

  return (
    <AttributionPanel
      title="Historical Conversion Journeys"
      subtitle="Recent stitched purchases come from the existing analytics API. The first 10 are rendered initially and the rest are fetched on demand."
      actions={
        <Badge className="border-white/10 bg-white/[0.05] px-3 py-1.5 text-white/70">
          {purchases.length} loaded
        </Badge>
      }
      className="h-full"
      bodyClassName="pt-4"
    >
      <JourneyListInner
        purchases={purchases}
        selectedPurchaseKey={selectedPurchaseKey}
        loading={loading}
        fetching={fetching}
        canLoadMore={canLoadMore}
        scrollAreaClassName={scrollAreaClassName}
        onSelect={onSelect}
        onLoadMore={onLoadMore}
      />
    </AttributionPanel>
  );
}
