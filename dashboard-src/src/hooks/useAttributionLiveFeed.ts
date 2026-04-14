import { useEffect, useMemo, useRef, useState } from "react";

import {
  LIVE_FEED_BUFFER_LIMIT,
  LIVE_FEED_PAGE_SIZE,
  normalizeShop,
} from "@/lib/attribution";
import type { LiveFeedEvent } from "@/types/attribution";

function normalizeFeedEvent(payload: any): LiveFeedEvent | null {
  if (!payload || typeof payload !== "object") return null;
  if (payload.type === "connected") return null;

  return {
    type: payload.type || null,
    accountId: payload.accountId || payload.shopId || null,
    shopId: payload.shopId || payload.accountId || null,
    sessionId: payload.sessionId || null,
    userKey: payload.userKey || null,
    eventId: payload.eventId || null,
    timestamp: payload.timestamp || payload.payload?.timestamp || null,
    payload: payload.payload || {},
  };
}

export function useAttributionLiveFeed(shop?: string) {
  const [events, setEvents] = useState<LiveFeedEvent[]>([]);
  const [connectionState, setConnectionState] = useState<"idle" | "connecting" | "open" | "closed" | "error">("idle");
  const [visibleCount, setVisibleCount] = useState(LIVE_FEED_PAGE_SIZE);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const normalizedShop = normalizeShop(shop);
    setEvents([]);
    setVisibleCount(LIVE_FEED_PAGE_SIZE);

    if (!normalizedShop) {
      setConnectionState("idle");
      return;
    }

    setConnectionState("connecting");
    const source = new EventSource(`/api/feed/${encodeURIComponent(normalizedShop)}`, {
      withCredentials: true,
    });
    sourceRef.current = source;

    source.onopen = () => setConnectionState("open");
    source.onerror = () => setConnectionState("error");
    source.onmessage = (message) => {
      try {
        const parsed = JSON.parse(message.data);
        const normalized = normalizeFeedEvent(parsed);
        if (!normalized) return;

        setEvents((current) => {
          const next = [normalized, ...current.filter((item) => item.eventId !== normalized.eventId)];
          if (next.length > LIVE_FEED_BUFFER_LIMIT) return next.slice(0, LIVE_FEED_BUFFER_LIMIT);
          return next;
        });
      } catch {
        // ignore malformed events
      }
    };

    return () => {
      setConnectionState("closed");
      source.close();
      sourceRef.current = null;
    };
  }, [shop]);

  const visibleEvents = useMemo(() => events.slice(0, visibleCount), [events, visibleCount]);

  return {
    events: visibleEvents,
    totalBufferedEvents: events.length,
    hiddenCount: Math.max(0, events.length - visibleCount),
    connectionState,
    loadMore() {
      setVisibleCount((current) => Math.min(events.length, current + LIVE_FEED_PAGE_SIZE));
    },
  };
}
