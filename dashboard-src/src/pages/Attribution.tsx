import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AlertTriangle } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { DashboardLayout } from "@/components/DashboardLayout";
import { AttributionDataEnrichmentPanel } from "@/components/attribution/AttributionDataEnrichmentPanel";
import { AttributionFilters } from "@/components/attribution/AttributionFilters";
import { AttributionJourneyDetail } from "@/components/attribution/AttributionJourneyDetail";
import { AttributionJourneyList } from "@/components/attribution/AttributionJourneyList";
import { AttributionLiveFeedPanel } from "@/components/attribution/AttributionLiveFeedPanel";
import { AttributionOverview } from "@/components/attribution/AttributionOverview";
import { AttributionPanel } from "@/components/attribution/AttributionPanel";
import { AttributionMetricCarousel } from "@/components/attribution/AttributionMetricCarousel";
import { AttributionPaidMediaPanel } from "@/components/attribution/AttributionPaidMediaPanel";
import { Badge } from "@/components/ui/badge";
import { useAttributionDashboard, useAttributionShops } from "@/hooks/useAttributionDashboard";
import { useAttributionLiveFeed } from "@/hooks/useAttributionLiveFeed";
import {
  buildPresetDates,
  JOURNEY_PAGE_SIZE,
  makePurchaseKey,
  normalizeShop,
  persistAttributionShop,
  type RangePreset,
} from "@/lib/attribution";
import type { AttributionModel } from "@/types/attribution";
import "@/components/attribution/legacy-attribution.css";

const DEFAULT_MODEL: AttributionModel = "last_touch";

function parseBooleanParam(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeModelParam(value?: string | null): AttributionModel {
  const normalized = String(value || "").trim().toLowerCase();
  if (["first_touch", "last_touch", "linear", "meta", "google_ads"].includes(normalized)) {
    return normalized as AttributionModel;
  }
  return DEFAULT_MODEL;
}

function inferRangePreset(start: string, end: string, allTime: boolean): RangePreset {
  if (allTime) return "all";

  const comparablePresets: RangePreset[] = ["7d", "30d", "90d", "180d"];
  const matched = comparablePresets.find((preset) => {
    const dates = buildPresetDates(preset);
    return dates.start === start && dates.end === end;
  });

  if (matched) return matched;
  if (start || end) return "custom";
  return "30d";
}

export default function Attribution() {
  const [searchParams, setSearchParams] = useSearchParams();
  const shopFromUrl = normalizeShop(
    searchParams.get("shop") || searchParams.get("shopId") || searchParams.get("store")
  );

  const initialAllTime = parseBooleanParam(searchParams.get("all_time") || searchParams.get("allTime"));
  const initialModel = normalizeModelParam(
    searchParams.get("attribution_model") || searchParams.get("attributionModel")
  );
  const initialPresetDates = initialAllTime ? buildPresetDates("all") : buildPresetDates("30d");
  const initialStart = searchParams.get("start") || initialPresetDates.start;
  const initialEnd = searchParams.get("end") || initialPresetDates.end;

  const [rangePreset, setRangePreset] = useState<RangePreset>(
    inferRangePreset(initialStart, initialEnd, initialAllTime)
  );
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  const [allTime, setAllTime] = useState(initialAllTime);
  const [attributionModel, setAttributionModel] = useState<AttributionModel>(initialModel);
  const [recentLimit, setRecentLimit] = useState(JOURNEY_PAGE_SIZE);
  const [selectedPurchaseKey, setSelectedPurchaseKey] = useState("");
  const [journeyMode, setJourneyMode] = useState<"condensed" | "full">("condensed");

  const patchSearchParams = useCallback(
    (patch: Record<string, string | null | undefined>) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          Object.entries(patch).forEach(([key, value]) => {
            if (!value) next.delete(key);
            else next.set(key, value);
          });
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const { activeShop, availableShops, loading: shopsLoading, error: shopsError } = useAttributionShops({
    shopFromUrl,
  });

  useEffect(() => {
    if (!activeShop || activeShop === shopFromUrl) return;
    patchSearchParams({
      shop: activeShop,
      shopId: null,
      store: null,
    });
  }, [activeShop, patchSearchParams, shopFromUrl]);

  useEffect(() => {
    setRecentLimit(JOURNEY_PAGE_SIZE);
  }, [activeShop, allTime, attributionModel, end, start]);

  const analyticsQuery = useAttributionDashboard({
    shop: activeShop,
    start,
    end,
    allTime,
    attributionModel,
    recentLimit,
  });

  const liveFeed = useAttributionLiveFeed(activeShop);

  const recentPurchases = analyticsQuery.data?.recentPurchases || [];

  useEffect(() => {
    if (!recentPurchases.length) {
      if (selectedPurchaseKey) setSelectedPurchaseKey("");
      return;
    }

    if (recentPurchases.some((purchase) => makePurchaseKey(purchase) === selectedPurchaseKey)) return;

    setSelectedPurchaseKey(makePurchaseKey(recentPurchases[0]));
  }, [recentPurchases, selectedPurchaseKey]);

  const selectedPurchase = useMemo(
    () => recentPurchases.find((purchase) => makePurchaseKey(purchase) === selectedPurchaseKey) || recentPurchases[0] || null,
    [recentPurchases, selectedPurchaseKey]
  );
  const deferredSelectedPurchase = useDeferredValue(selectedPurchase);

  const syncFilterParams = useCallback(
    (next: {
      nextStart: string;
      nextEnd: string;
      nextAllTime: boolean;
      nextModel?: AttributionModel;
    }) => {
      patchSearchParams({
        start: next.nextAllTime ? null : next.nextStart || null,
        end: next.nextAllTime ? null : next.nextEnd || null,
        all_time: next.nextAllTime ? "1" : null,
        attribution_model: next.nextModel || attributionModel,
      });
    },
    [attributionModel, patchSearchParams]
  );

  const handleShopChange = useCallback(
    (value: string) => {
      persistAttributionShop(value);
      patchSearchParams({
        shop: value,
        shopId: null,
        store: null,
      });
    },
    [patchSearchParams]
  );

  const handleRangePresetChange = useCallback(
    (value: RangePreset) => {
      setRangePreset(value);

      if (value === "custom") {
        setAllTime(false);
        syncFilterParams({ nextStart: start, nextEnd: end, nextAllTime: false });
        return;
      }

      const next = buildPresetDates(value);
      setStart(next.start);
      setEnd(next.end);
      setAllTime(next.allTime);
      syncFilterParams({
        nextStart: next.start,
        nextEnd: next.end,
        nextAllTime: next.allTime,
      });
    },
    [end, start, syncFilterParams]
  );

  const handleStartChange = useCallback(
    (value: string) => {
      setRangePreset("custom");
      setAllTime(false);
      setStart(value);
      syncFilterParams({ nextStart: value, nextEnd: end, nextAllTime: false });
    },
    [end, syncFilterParams]
  );

  const handleEndChange = useCallback(
    (value: string) => {
      setRangePreset("custom");
      setAllTime(false);
      setEnd(value);
      syncFilterParams({ nextStart: start, nextEnd: value, nextAllTime: false });
    },
    [start, syncFilterParams]
  );

  const handleModelChange = useCallback(
    (value: AttributionModel) => {
      setAttributionModel(value);
      syncFilterParams({
        nextStart: start,
        nextEnd: end,
        nextAllTime: allTime,
        nextModel: value,
      });
    },
    [allTime, end, start, syncFilterParams]
  );

  const handleSelectPurchase = useCallback((purchase: typeof recentPurchases[number]) => {
    startTransition(() => {
      setSelectedPurchaseKey(makePurchaseKey(purchase));
    });
  }, []);

  const canLoadMoreJourneys = recentPurchases.length >= recentLimit;
  const topLevelError = shopsError || (analyticsQuery.error as Error | undefined)?.message || "";

  return (
    <DashboardLayout>
      <div className="adray-dashboard min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(181,92,255,0.16),transparent_32%),radial-gradient(circle_at_top_right,rgba(79,227,193,0.08),transparent_30%),linear-gradient(180deg,#060609_0%,#09090E_42%,#050507_100%)] text-white">
        <div className="mx-auto flex w-full max-w-[1700px] min-w-0 flex-col gap-6 px-4 py-4 md:px-6 md:py-6">
          <AttributionFilters
            shop={activeShop}
            availableShops={availableShops}
            rangePreset={rangePreset}
            start={start}
            end={end}
            allTime={allTime}
            attributionModel={attributionModel}
            loading={shopsLoading || analyticsQuery.isLoading}
            fetching={analyticsQuery.isFetching}
            onShopChange={handleShopChange}
            onRangePresetChange={handleRangePresetChange}
            onStartChange={handleStartChange}
            onEndChange={handleEndChange}
            onAttributionModelChange={handleModelChange}
            onRefresh={() => {
              void analyticsQuery.refetch();
            }}
          />

          {topLevelError ? (
            <div className="flex items-start gap-3 rounded-[24px] border border-amber-400/18 bg-amber-400/10 px-5 py-4 text-sm text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-semibold">Attribution frontend warning</p>
                <p className="mt-1 text-amber-50/85">{topLevelError}</p>
              </div>
            </div>
          ) : null}

          <AttributionMetricCarousel
            data={analyticsQuery.data}
            loading={Boolean((shopsLoading || analyticsQuery.isLoading) && !analyticsQuery.data)}
          />

          <div className="dashboard-top-row grid grid-cols-1 items-stretch gap-8 lg:grid-cols-3">
            <AttributionLiveFeedPanel
              events={liveFeed.events}
              hiddenCount={liveFeed.hiddenCount}
              connectionState={liveFeed.connectionState}
              onLoadMore={liveFeed.loadMore}
            />

            <AttributionPanel
              title="Conversion paths"
              kicker="Attribution"
              subtitle="Follow stitched journeys from historical purchases, then inspect the selected path without leaving the page."
              className="conversion-paths-shell h-full lg:col-span-2"
              bodyClassName="pt-4"
              actions={
                <div className="flex flex-wrap gap-2">
                  <Badge className="border-white/10 bg-white/[0.05] px-3 py-1.5 text-white/72">All</Badge>
                  <Badge className="border-[#4A66B7]/30 bg-[#4A66B7]/16 px-3 py-1.5 text-[#E5EDFF]">Meta</Badge>
                  <Badge className="border-[#B88B3A]/30 bg-[#B88B3A]/14 px-3 py-1.5 text-[#FCE7BC]">Google</Badge>
                  <Badge className="border-[#2B9E8C]/30 bg-[#2B9E8C]/14 px-3 py-1.5 text-[#DDF9F3]">TikTok</Badge>
                  <Badge className="border-[#3F7F54]/30 bg-[#3F7F54]/14 px-3 py-1.5 text-[#E1F7E9]">Organic</Badge>
                </div>
              }
            >
              <div className="conversion-paths-grid grid grid-cols-1 gap-6 xl:grid-cols-2">
                <AttributionJourneyList
                  purchases={recentPurchases}
                  selectedPurchaseKey={selectedPurchaseKey}
                  loading={Boolean(analyticsQuery.isLoading && !analyticsQuery.data)}
                  fetching={analyticsQuery.isFetching}
                  canLoadMore={canLoadMoreJourneys}
                  embedded
                  scrollAreaClassName="h-[42rem] pr-3"
                  onSelect={handleSelectPurchase}
                  onLoadMore={() => setRecentLimit((current) => current + JOURNEY_PAGE_SIZE)}
                />

                <AttributionJourneyDetail
                  purchase={deferredSelectedPurchase}
                  mode={journeyMode}
                  embedded
                  scrollAreaClassName="h-[42rem] pr-3"
                  onModeChange={setJourneyMode}
                />
              </div>
            </AttributionPanel>
          </div>

          <AttributionOverview
            data={analyticsQuery.data}
            loading={Boolean((shopsLoading || analyticsQuery.isLoading) && !analyticsQuery.data)}
          />

          <div className="dashboard-support-grid grid grid-cols-1 gap-8 lg:grid-cols-2">
            <AttributionPaidMediaPanel data={analyticsQuery.data} />
            <AttributionDataEnrichmentPanel purchase={deferredSelectedPurchase} />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
