import { useEffect, useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import {
  fetchJson,
  normalizeShop,
  persistAttributionShop,
  readStoredAttributionShop,
} from "@/lib/attribution";
import type {
  AnalyticsDashboardResponse,
  AnalyticsShopsResponse,
  AttributionModel,
  SessionResponse,
} from "@/types/attribution";

type UseAttributionShopsParams = {
  shopFromUrl?: string | null;
  onResolvedShop?: (shop: string) => void;
};

type UseAttributionDashboardParams = {
  shop?: string;
  start?: string;
  end?: string;
  allTime?: boolean;
  attributionModel?: AttributionModel;
  recentLimit?: number;
};

const PREFERRED_DEFAULT_SHOP = "shogun.mx";

function resolvePreferredShop(shops: string[]) {
  return (
    shops.find((entry) => normalizeShop(entry).toLowerCase() === PREFERRED_DEFAULT_SHOP) ||
    ""
  );
}

export function useAttributionShops({
  shopFromUrl,
  onResolvedShop,
}: UseAttributionShopsParams) {
  const sessionQuery = useQuery({
    queryKey: ["attribution", "session"],
    queryFn: () => fetchJson<SessionResponse>("/api/session"),
    staleTime: 60_000,
  });

  const shopsQuery = useQuery({
    queryKey: ["attribution", "shops"],
    queryFn: () => fetchJson<AnalyticsShopsResponse>("/api/analytics/shops"),
    staleTime: 60_000,
  });

  const sessionShop = normalizeShop(
    sessionQuery.data?.user?.shop || sessionQuery.data?.user?.resolvedShop || ""
  );

  const availableShops = useMemo(
    () => {
      const shops = (shopsQuery.data?.shops || [])
        .map((entry) => normalizeShop(entry.shop))
        .filter(Boolean);
      const preferred = resolvePreferredShop(shops);
      if (!preferred) return shops;
      return [preferred, ...shops.filter((entry) => entry !== preferred)];
    },
    [shopsQuery.data?.shops]
  );

  const resolvedShop = useMemo(() => {
    const urlShop = normalizeShop(shopFromUrl);
    if (urlShop) return urlShop;

    const preferredShop = resolvePreferredShop(availableShops);
    if (preferredShop) return preferredShop;

    const storedShop = readStoredAttributionShop();
    if (storedShop) return storedShop;

    const defaultShop = normalizeShop(shopsQuery.data?.defaultShop || "");
    if (defaultShop) return defaultShop;

    if (sessionShop) return sessionShop;

    return availableShops[0] || "";
  }, [availableShops, sessionShop, shopFromUrl, shopsQuery.data?.defaultShop]);

  useEffect(() => {
    if (!resolvedShop) return;
    persistAttributionShop(resolvedShop);
    onResolvedShop?.(resolvedShop);
  }, [onResolvedShop, resolvedShop]);

  return {
    activeShop: resolvedShop,
    availableShops,
    loading: sessionQuery.isLoading || shopsQuery.isLoading,
    error:
      (sessionQuery.error as Error | undefined)?.message ||
      (shopsQuery.error as Error | undefined)?.message ||
      "",
  };
}

export function useAttributionDashboard({
  shop,
  start,
  end,
  allTime,
  attributionModel = "last_touch",
  recentLimit = 10,
}: UseAttributionDashboardParams) {
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (start) params.set("start", start);
    if (end) params.set("end", end);
    if (allTime) params.set("all_time", "1");
    params.set("attribution_model", attributionModel);
    params.set("recent_limit", String(recentLimit));
    return params.toString();
  }, [allTime, attributionModel, end, recentLimit, start]);

  return useQuery({
    queryKey: ["attribution", "analytics", shop, queryString],
    enabled: Boolean(shop),
    placeholderData: keepPreviousData,
    queryFn: () =>
      fetchJson<AnalyticsDashboardResponse>(
        `/api/analytics/${encodeURIComponent(String(shop || ""))}${queryString ? `?${queryString}` : ""}`
      ),
  });
}
