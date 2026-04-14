import { DatabaseZap, Info, Link2 } from "lucide-react";

import { AttributionPanel } from "@/components/attribution/AttributionPanel";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildDeliveryPlatformRows, buildJourneySummary } from "@/lib/attribution-view-models";
import { formatMoney } from "@/lib/attribution";
import type { RecentPurchase } from "@/types/attribution";

type AttributionDataEnrichmentPanelProps = {
  purchase?: RecentPurchase | null;
};

export function AttributionDataEnrichmentPanel({
  purchase,
}: AttributionDataEnrichmentPanelProps) {
  const platforms = buildDeliveryPlatformRows(purchase);
  const journeySummary = buildJourneySummary(purchase);

  return (
    <AttributionPanel
      title="Data Enrichment"
      kicker="Data Pipeline"
      subtitle="Accurate data signals sent per order to their respective attribution platforms."
      className="support-shell"
      actions={
        purchase?.orderNumber || purchase?.orderId ? (
          <Badge className="border-white/10 bg-white/[0.05] px-3 py-1.5 text-white/72">
            Order #{purchase.orderNumber || purchase.orderId}
          </Badge>
        ) : null
      }
    >
      {!purchase ? (
        <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-6 py-10 text-center text-sm leading-6 text-white/55">
          Choose a purchase to inspect delivery receipts, identity signals, and sync metadata.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">Revenue</p>
              <p className="mt-3 text-xl font-semibold text-white">
                {formatMoney(purchase.revenue, purchase.currency || "MXN")}
              </p>
              <p className="mt-2 text-sm text-white/58">{purchase.source || "Synced through analytics orchestration"}</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">Attribution</p>
              <p className="mt-3 text-xl font-semibold text-white">{journeySummary.attributionLabel}</p>
              <p className="mt-2 text-sm text-white/58">{purchase.attributionModel || "last_touch"} model</p>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">Signals</p>
              <p className="mt-3 text-xl font-semibold text-white">{journeySummary.signalChips.length}</p>
              <p className="mt-2 text-sm text-white/58">Enrichment markers attached to the stitched journey.</p>
            </div>
          </div>

          <div className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center gap-3">
              <DatabaseZap className="h-4 w-4 text-[#7EF0C8]" />
              <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-[#D8C7EE]">
                Platform delivery receipts
              </h3>
            </div>

            <div className="mt-4 space-y-3">
              {platforms.length ? (
                platforms.map((platform) => (
                  <div
                    key={platform.key}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <Badge className={`px-3 py-1.5 ${platform.toneClassName}`}>{platform.label}</Badge>
                      <p className="text-sm text-white/70">{platform.statusLabel}</p>
                    </div>

                    {platform.detailLines.length ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/70 hover:bg-white/[0.08]"
                          >
                            <Info className="h-3.5 w-3.5" />
                            Details
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="z-[2147483647] max-w-sm border-white/10 bg-[#0C0A13] text-white">
                          <div className="space-y-1 text-xs leading-5 text-white/75">
                            {platform.detailLines.map((line) => (
                              <p key={`${platform.key}-${line}`}>{line}</p>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-xs text-white/42">No receipt metadata recorded yet.</span>
                    )}
                  </div>
                ))
              ) : (
                <div className="rounded-[20px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-5 text-sm text-white/55">
                  This purchase does not yet expose platform-specific delivery receipts in the current API payload.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center gap-3">
              <Link2 className="h-4 w-4 text-[#D2A7FF]" />
              <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-[#D8C7EE]">
                Journey identity signals
              </h3>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {journeySummary.signalChips.length ? (
                journeySummary.signalChips.map((signal) => (
                  <Badge
                    key={signal}
                    className="border-[#B55CFF]/18 bg-[#B55CFF]/10 px-3 py-1.5 text-[#F0DEFF]"
                  >
                    {signal}
                  </Badge>
                ))
              ) : (
                <span className="text-sm text-white/50">No explicit enrichment signals were exposed for this purchase.</span>
              )}
            </div>
          </div>
        </div>
      )}
    </AttributionPanel>
  );
}
