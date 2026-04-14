import { Activity, ArrowDown, Radio, RefreshCcw } from "lucide-react";

import { AttributionPanel } from "@/components/attribution/AttributionPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  formatPercent,
  liveFeedCommerceLabel,
  liveFeedEventLabel,
  liveFeedEventPath,
  liveFeedEventTimestamp,
  resolveChannelTone,
} from "@/lib/attribution";
import type { LiveFeedEvent } from "@/types/attribution";

type AttributionLiveFeedPanelProps = {
  events: LiveFeedEvent[];
  hiddenCount: number;
  connectionState: "idle" | "connecting" | "open" | "closed" | "error";
  onLoadMore: () => void;
};

function connectionLabel(state: AttributionLiveFeedPanelProps["connectionState"]) {
  if (state === "open") return "Live";
  if (state === "connecting") return "Connecting";
  if (state === "error") return "Retrying";
  if (state === "closed") return "Closed";
  return "Idle";
}

function connectionTone(state: AttributionLiveFeedPanelProps["connectionState"]) {
  if (state === "open") return "border-[#4FE3C1]/25 bg-[#4FE3C1]/10 text-[#DFFBF3]";
  if (state === "error") return "border-red-400/20 bg-red-400/10 text-red-200";
  if (state === "connecting") return "border-[#F3C77A]/25 bg-[#F3C77A]/10 text-[#FFE6B8]";
  return "border-white/10 bg-white/[0.05] text-white/65";
}

export function AttributionLiveFeedPanel({
  events,
  hiddenCount,
  connectionState,
  onLoadMore,
}: AttributionLiveFeedPanelProps) {
  return (
    <AttributionPanel
      title="Live Feed"
      kicker="Real Time"
      subtitle="Follow the latest events hitting the pixel and stitched activity stream in real time."
      actions={
        <Badge className={`px-3 py-1.5 ${connectionTone(connectionState)}`}>
          <Radio className={`mr-1.5 h-3.5 w-3.5 ${connectionState === "open" ? "animate-pulse" : ""}`} />
          {connectionLabel(connectionState)}
        </Badge>
      }
      bodyClassName="pt-4"
      className="live-feed-shell h-full"
    >
      <ScrollArea className="h-[32rem] pr-3">
        <div className="space-y-3">
          {events.length ? (
            events.map((event) => {
              const tone = resolveChannelTone(
                event.payload?.platform || event.payload?.rawSource || event.payload?.source || "Direct"
              );
              const label = liveFeedEventLabel(event);
              const path = liveFeedEventPath(event);
              const commerceLabel = liveFeedCommerceLabel(event);

              return (
                <article
                  key={event.eventId || `${event.sessionId}-${event.timestamp}`}
                  className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4 shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span className={`h-2.5 w-2.5 rounded-full ${tone.dot}`} />
                        <h3 className="truncate text-lg font-semibold tracking-[-0.03em] text-white">
                          {label}
                        </h3>
                      </div>
                      <p className="mt-2 text-sm text-white/60">{liveFeedEventTimestamp(event)}</p>
                    </div>
                    <Badge className={`shrink-0 border px-3 py-1.5 ${tone.badge}`}>
                      {event.payload?.platform || event.payload?.rawSource || "Pixel"}
                    </Badge>
                  </div>

                  <div className="mt-4 space-y-2 text-sm text-white/65">
                    {path ? <p className="truncate text-white/78">{path}</p> : null}
                    {commerceLabel ? <p className="text-white/78">{commerceLabel}</p> : null}
                    {(event.payload?.matchType || event.payload?.confidenceScore != null) ? (
                      <div className="flex flex-wrap gap-2">
                        {event.payload?.matchType ? (
                          <Badge className="border-white/10 bg-white/[0.05] px-3 py-1 text-white/70">
                            {event.payload.matchType}
                          </Badge>
                        ) : null}
                        {event.payload?.confidenceScore != null ? (
                          <Badge className="border-white/10 bg-white/[0.05] px-3 py-1 text-white/70">
                            Confidence {formatPercent(event.payload.confidenceScore, 0)}
                          </Badge>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })
          ) : (
            <div className="flex h-[16rem] items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-6 text-center text-sm leading-6 text-white/55">
              Waiting for SSE events from <code className="mx-1 text-white/70">/api/feed/:shop</code>.
              Once the browser pixel or order webhook emits events, they will stream here.
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="mt-5 flex items-center justify-between gap-3 rounded-[22px] border border-white/8 bg-white/[0.03] px-4 py-3">
        <div className="text-sm text-white/60">
          {hiddenCount > 0
            ? `${hiddenCount} older live event${hiddenCount === 1 ? "" : "s"} buffered but not rendered yet.`
            : "All buffered live events are currently visible."}
        </div>
        {hiddenCount > 0 ? (
          <Button
            type="button"
            onClick={onLoadMore}
            className="rounded-2xl border border-[#B55CFF]/20 bg-[#B55CFF]/14 px-4 text-white hover:bg-[#B55CFF]/22"
          >
            <ArrowDown className="h-4 w-4" />
            Load More
          </Button>
        ) : (
          <div className="inline-flex items-center gap-2 text-xs text-white/45">
            <RefreshCcw className="h-3.5 w-3.5" />
            Live updates remain active
          </div>
        )}
      </div>
    </AttributionPanel>
  );
}
