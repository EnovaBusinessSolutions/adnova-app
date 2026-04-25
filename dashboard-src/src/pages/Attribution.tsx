import { useCallback, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { AttributionHeader } from '@/features/attribution/components/AttributionHeader';
import { KpiGrid } from '@/features/attribution/components/KpiGrid';
import { LiveFeed } from '@/features/attribution/components/LiveFeed';
import { ConversionPaths } from '@/features/attribution/components/ConversionPaths';
import { AttributionPieChart } from '@/features/attribution/components/AttributionPieChart';
import { RoasComparisonChart } from '@/features/attribution/components/RoasComparisonChart';
import { PaidMediaPanel } from '@/features/attribution/components/PaidMediaPanel';
import { TopProductsPanel } from '@/features/attribution/components/TopProductsPanel';
import { DataEnrichmentPanel } from '@/features/attribution/components/DataEnrichmentPanel';
import { ExportModal } from '@/features/attribution/components/ExportModal';
import { useShops } from '@/features/attribution/hooks/useShops';
import { useShopPersistence } from '@/features/attribution/hooks/useShopPersistence';
import { useAttributionFilters } from '@/features/attribution/hooks/useAttributionFilters';
import { useAnalytics } from '@/features/attribution/hooks/useAnalytics';
import { useGa4Channels } from '@/features/attribution/hooks/useGa4Channels';

function SupportGridSkeleton() {
  return (
    <section className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <Skeleton className="mb-4 h-4 w-28 rounded bg-white/[0.06]" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, j) => (
              <Skeleton key={j} className="h-14 w-full rounded-xl bg-white/[0.04]" />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export default function Attribution() {
  const { data: shopsData, isLoading: shopsLoading } = useShops();
  const { shop, setShop } = useShopPersistence();
  const { model, range, start, end, setModel, setRange, setStart, setEnd } =
    useAttributionFilters();

  const resolvedShop =
    shop ||
    (shopsData?.defaultShop ?? '') ||
    (shopsData?.shops?.[0]?.shop ?? '');

  const {
    data: analyticsData,
    isLoading: analyticsLoading,
    isFetching,
    refetch,
  } = useAnalytics({ shopId: resolvedShop, model, range, start, end });

  const { data: ga4Channels, isLoading: ga4Loading } = useGa4Channels(resolvedShop);

  const [exportOpen, setExportOpen] = useState(false);

  const handleRefresh = useCallback(() => { void refetch(); }, [refetch]);
  const handleExport = useCallback(() => setExportOpen(true), []);

  if (!shopsLoading && shopsData?.shops?.length === 0) {
    return <Navigate to="/?openPixelWizard=1" replace />;
  }

  const channels = analyticsData?.channels;
  const purchases = analyticsData?.recentPurchases ?? [];
  const currency = analyticsData?.paidMedia?.blended?.currency ?? null;

  return (
    <DashboardLayout>
      <div className="flex flex-col bg-[#050508]">
        <AttributionHeader
          shops={shopsData?.shops ?? []}
          shopsLoading={shopsLoading}
          shop={resolvedShop}
          onShopChange={setShop}
          model={model}
          onModelChange={setModel}
          range={range}
          start={start}
          end={end}
          onRangeChange={setRange}
          onStartChange={setStart}
          onEndChange={setEnd}
          onRefresh={handleRefresh}
          onExport={handleExport}
          isRefreshing={isFetching}
        />

        <div className="flex-1 space-y-3 p-3 sm:space-y-5 sm:p-4 md:p-6">
          {analyticsData?.degraded && (
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-400 sm:px-4 sm:py-2.5">
              Showing cached data — database temporarily unavailable.
            </div>
          )}

          {/* KPIs */}
          <section>
            <KpiGrid data={analyticsData} loading={analyticsLoading} />
          </section>

          {/* Live Feed (1/3) + Conversion Paths (2/3) */}
          {resolvedShop && (
            <section className="flex flex-col gap-3 sm:gap-5 lg:h-[520px] lg:flex-row">
              <div className="h-[360px] overflow-hidden sm:h-[420px] lg:h-full lg:flex-[1]">
                <LiveFeed shopId={resolvedShop} />
              </div>
              <div className="h-[520px] overflow-hidden lg:h-full lg:flex-[2]">
                <ConversionPaths purchases={purchases} />
              </div>
            </section>
          )}

          {/* ROAS Comparison + Attributed Orders — 50/50 */}
          {!analyticsLoading && analyticsData && channels && (
            <section className="grid grid-cols-1 gap-3 sm:gap-5 lg:grid-cols-2">
              <div className="h-[300px]">
                <RoasComparisonChart
                  paidMedia={analyticsData.paidMedia}
                  channels={channels}
                  model={model}
                />
              </div>
              <div className="h-[300px]">
                <AttributionPieChart channels={channels} ga4={ga4Channels} ga4Loading={ga4Loading} />
              </div>
            </section>
          )}

          {/* Support Grid: Paid Media | Data Enrichment */}
          {analyticsLoading ? (
            <SupportGridSkeleton />
          ) : analyticsData ? (
            <section className="grid grid-cols-1 gap-3 sm:gap-5 md:grid-cols-2">
              <PaidMediaPanel
                paidMedia={analyticsData.paidMedia}
                integrationHealth={analyticsData.integrationHealth}
                currency={currency}
              />
              <DataEnrichmentPanel purchases={purchases} loading={analyticsLoading} />
            </section>
          ) : null}

          {/* Top Products */}
          <section>
            <TopProductsPanel products={analyticsData?.topProducts ?? []} currency={currency} />
          </section>
        </div>
      </div>

      {/* Overlays */}
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        data={analyticsData}
        shop={resolvedShop}
        model={model}
        range={range}
        start={start}
        end={end}
      />
    </DashboardLayout>
  );
}
