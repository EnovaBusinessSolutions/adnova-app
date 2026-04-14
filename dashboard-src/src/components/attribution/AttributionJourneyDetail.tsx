import { startTransition, useMemo } from "react";
import { CheckCircle2, Layers3, Route } from "lucide-react";

import { AttributionPanel } from "@/components/attribution/AttributionPanel";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  buildCondensedJourneyEvents,
  buildJourneyNarrative,
  collectJourneyUtmHistory,
  eventDisplayName,
  formatPercent,
  formatRelativeGap,
  formatShortDate,
  formatTimestamp,
  getSessionIdsForPurchase,
  groupJourneyEventsBySession,
  isPurchaseEvent,
  resolveAttributionLabel,
  resolveChannelTone,
  safePathname,
} from "@/lib/attribution";
import { buildJourneySummary } from "@/lib/attribution-view-models";
import { cn } from "@/lib/utils";
import type { JourneyEvent, RecentPurchase } from "@/types/attribution";

type JourneyMode = "condensed" | "full";

type AttributionJourneyDetailProps = {
  purchase?: RecentPurchase | null;
  mode: JourneyMode;
  embedded?: boolean;
  className?: string;
  scrollAreaClassName?: string;
  onModeChange: (value: JourneyMode) => void;
};

function eventTimestamp(event: JourneyEvent) {
  return formatTimestamp(event.createdAt || event.collectedAt || null);
}

function renderEventDetails(event: JourneyEvent) {
  const productName = String(event.productName || "").trim();
  if (productName) return productName;

  const path = safePathname(event.pageUrl);
  if (path) return path;

  if (event.productId) return `Product ${event.productId}`;
  if (event.itemId) return `Item ${event.itemId}`;
  if (event.checkoutToken) return `Checkout ${String(event.checkoutToken).slice(0, 10)}`;
  if (event.orderId) return `Order ${event.orderId}`;
  return "Captured from the shared stitched event stream.";
}

function buildVisibleEvents(purchase?: RecentPurchase | null, mode: JourneyMode = "condensed") {
  const chronological = [...(purchase?.events || [])].sort(
    (left, right) =>
      new Date(left.createdAt || left.collectedAt || 0).getTime() -
      new Date(right.createdAt || right.collectedAt || 0).getTime()
  );

  if (mode === "full") return chronological;

  const condensed = buildCondensedJourneyEvents(chronological);
  const purchaseEvent = [...chronological].reverse().find((event) => isPurchaseEvent(event.eventName));

  if (!purchaseEvent || condensed.some((event) => isPurchaseEvent(event.eventName))) return condensed;

  return [...condensed, purchaseEvent].sort(
    (left, right) =>
      new Date(left.createdAt || left.collectedAt || 0).getTime() -
      new Date(right.createdAt || right.collectedAt || 0).getTime()
  );
}

function JourneyModeToggle({
  mode,
  onModeChange,
}: {
  mode: JourneyMode;
  onModeChange: (value: JourneyMode) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
      {(["condensed", "full"] as JourneyMode[]).map((entry) => {
        const active = entry === mode;
        return (
          <button
            key={entry}
            type="button"
            onClick={() => startTransition(() => onModeChange(entry))}
            className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] transition ${
              active ? "bg-[#B55CFF] text-white shadow-[0_10px_24px_rgba(181,92,255,0.35)]" : "text-white/60"
            }`}
          >
            {entry}
          </button>
        );
      })}
    </div>
  );
}

export function AttributionJourneyDetail({
  purchase,
  mode,
  embedded = false,
  className,
  scrollAreaClassName,
  onModeChange,
}: AttributionJourneyDetailProps) {
  const visibleEvents = useMemo(() => buildVisibleEvents(purchase, mode), [mode, purchase]);
  const groupedSessions = useMemo(() => groupJourneyEventsBySession(visibleEvents), [visibleEvents]);
  const utmHistory = useMemo(() => collectJourneyUtmHistory(purchase), [purchase]);
  const summary = useMemo(() => buildJourneySummary(purchase), [purchase]);
  const sessionIds = useMemo(() => getSessionIdsForPurchase(purchase), [purchase]);
  const content = !purchase ? (
    <div className="flex min-h-[26rem] items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-6 text-center text-sm leading-6 text-white/55">
      Pick a stitched purchase from the list to inspect its native React journey timeline.
    </div>
  ) : (
    <div className="space-y-5">
      <div className="rounded-[26px] border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-white/58">{formatTimestamp(purchase.createdAt)}</p>
            <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">
              {purchase.customerName || `Order #${purchase.orderNumber || purchase.orderId || "--"}`}
            </h3>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/63">
              {`Stitched backward from purchase #${purchase.orderNumber || purchase.orderId || "--"} across ${summary.sessionCount} session${summary.sessionCount === 1 ? "" : "s"}.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-white/10 bg-white/[0.05] px-3 py-1.5 text-white/75">
              {formatPercent(purchase.attributionConfidence, 0)} confidence
            </Badge>
            <Badge className="border-[#B55CFF]/20 bg-[#B55CFF]/10 px-3 py-1.5 text-[#F0DEFF]">
              {summary.attributionLabel || resolveAttributionLabel(purchase)}
            </Badge>
            <Badge className="border-white/10 bg-white/[0.05] px-3 py-1.5 text-white/75">
              <Layers3 className="mr-1.5 h-3.5 w-3.5" />
              {sessionIds.length} session{sessionIds.length === 1 ? "" : "s"}
            </Badge>
          </div>
        </div>

        {summary.signalChips.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {summary.signalChips.map((signal) => (
              <Badge
                key={signal}
                className="border-[#4FE3C1]/20 bg-[#4FE3C1]/10 px-3 py-1.5 text-[#DFFBF3]"
              >
                {signal}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      {utmHistory.length ? (
        <div className="rounded-[26px] border border-white/10 bg-white/[0.03] p-5">
          <div className="flex items-center gap-3">
            <Route className="h-4 w-4 text-[#D2A7FF]" />
            <h4 className="text-sm font-semibold uppercase tracking-[0.24em] text-[#D8C7EE]">
              UTM URL history for this journey
            </h4>
          </div>
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {utmHistory.map((sessionGroup, index) => (
              <div
                key={`${sessionGroup.sessionKey}-${index}`}
                className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/45">
                  Session {index + 1}
                </p>
                <div className="mt-3 space-y-3">
                  {sessionGroup.urls.map((entry) => (
                    <div key={`${sessionGroup.sessionKey}-${entry.url}`} className="space-y-1">
                      <p className="break-all text-sm text-white/78">{entry.url}</p>
                      <p className="text-xs text-white/48">
                        {[entry.source, entry.medium, entry.campaign, entry.capturedAt ? formatShortDate(entry.capturedAt) : null]
                          .filter(Boolean)
                          .join(" - ")}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <ScrollArea className={cn("h-[34rem] pr-3", scrollAreaClassName)}>
        <div className="space-y-5">
          {groupedSessions.map((group, groupIndex) => {
            const sessionTone = resolveChannelTone(
              purchase.attributedChannel || purchase.attributedPlatform || purchase.wooSourceLabel || "Direct"
            );
            const firstEvent = group.events[0];
            const previousGroup = groupIndex > 0 ? groupedSessions[groupIndex - 1] : null;
            const previousLastEvent = previousGroup?.events[previousGroup.events.length - 1];
            const gapLabel = previousLastEvent
              ? formatRelativeGap(previousLastEvent.createdAt, firstEvent?.createdAt)
              : null;
            const purchaseIndex = group.events.findIndex((event) => isPurchaseEvent(event.eventName));

            return (
              <div key={`${group.sessionId}-${groupIndex}`} className="space-y-4">
                {groupIndex > 0 ? (
                  <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/60">
                    Returned {gapLabel || "later"} before Session {groupIndex + 1}.
                  </div>
                ) : null}

                <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className={`h-3 w-3 rounded-full ${sessionTone.dot}`} />
                      <Badge className="border-white/10 bg-white/[0.05] px-3 py-1.5 text-white/75">
                        Session {groupIndex + 1}
                      </Badge>
                      <p className="text-sm text-white/55">{eventTimestamp(firstEvent)}</p>
                    </div>
                    <p className="text-sm text-white/50">{group.sessionId === "unlinked" ? "Unlinked session" : group.sessionId}</p>
                  </div>

                  <p className="mt-4 text-sm leading-6 text-white/68">
                    Session {groupIndex + 1} {buildJourneyNarrative(purchase, group.sessionId).toLowerCase()}
                  </p>

                  <div className="mt-5 space-y-3">
                    {group.events.map((event, eventIndex) => {
                      const showPostPurchaseMarker =
                        purchaseIndex >= 0 && eventIndex === purchaseIndex + 1;
                      const eventTone = resolveChannelTone(
                        event.utmSource ||
                          event.ga4SessionSource ||
                          purchase.attributedChannel ||
                          purchase.attributedPlatform ||
                          "Direct"
                      );

                      return (
                        <div key={event.eventId || `${group.sessionId}-${eventIndex}`} className="space-y-3">
                          {showPostPurchaseMarker ? (
                            <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-white/55">
                              Post-purchase confirmation
                            </div>
                          ) : null}

                          <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-3">
                                  <span className={`h-2.5 w-2.5 rounded-full ${eventTone.dot}`} />
                                  <h4 className="truncate text-base font-semibold text-white">
                                    {eventDisplayName(event.eventName)}
                                  </h4>
                                  {isPurchaseEvent(event.eventName) ? (
                                    <CheckCircle2 className="h-4 w-4 text-[#4FE3C1]" />
                                  ) : null}
                                </div>
                                <p className="mt-2 text-sm text-white/65">{renderEventDetails(event)}</p>
                              </div>
                              <Badge className="border-white/10 bg-white/[0.05] px-3 py-1 text-white/70">
                                {eventTimestamp(event)}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );

  if (embedded) {
    return (
      <div className={cn("h-full rounded-[24px] border border-white/10 bg-[rgba(53,33,88,0.46)] p-5", className)}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[1.35rem] font-semibold tracking-[-0.03em] text-white">
              Selected Journey
            </h3>
            <p className="mt-2 text-sm leading-6 text-white/58">
              Native React rendering of the stitched purchase timeline, using the existing analytics API and backend receipts.
            </p>
          </div>
          <JourneyModeToggle mode={mode} onModeChange={onModeChange} />
        </div>

        <div className="mt-5">{content}</div>
      </div>
    );
  }

  return (
    <AttributionPanel
      title="Selected Journey"
      subtitle="This view is now rendered natively in React. Backend stitching and delivery receipts still come from the shared analytics API."
      actions={<JourneyModeToggle mode={mode} onModeChange={onModeChange} />}
      className="h-full"
      bodyClassName="pt-4"
    >
      {content}
    </AttributionPanel>
  );
}
