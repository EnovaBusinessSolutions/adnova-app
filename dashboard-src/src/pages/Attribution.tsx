import { useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/DashboardLayout';
import { AttributionHeader } from '@/features/attribution/components/AttributionHeader';
import { KpiGrid } from '@/features/attribution/components/KpiGrid';
import { LiveFeed } from '@/features/attribution/components/LiveFeed';
import { ConversionPaths } from '@/features/attribution/components/ConversionPaths';
import { AttributionPieChart } from '@/features/attribution/components/AttributionPieChart';
import { useShops } from '@/features/attribution/hooks/useShops';
import { useShopPersistence } from '@/features/attribution/hooks/useShopPersistence';
import { useAttributionFilters } from '@/features/attribution/hooks/useAttributionFilters';
import { useAnalytics } from '@/features/attribution/hooks/useAnalytics';

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

  const handleRefresh = useCallback(() => { void refetch(); }, [refetch]);
  const handleExport = useCallback(() => { /* Phase D */ }, []);

  if (!shopsLoading && shopsData?.shops?.length === 0) {
    return <Navigate to="/?openPixelWizard=1" replace />;
  }

  const channels = analyticsData?.channels;
  const purchases = analyticsData?.recentPurchases ?? [];

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

        <div className="flex-1 space-y-5 p-4 sm:p-6">
          {analyticsData?.degraded && (
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-4 py-2.5 text-xs text-yellow-400">
              Showing cached data — database temporarily unavailable.
            </div>
          )}

          {/* KPIs */}
          <section>
            <KpiGrid data={analyticsData} loading={analyticsLoading} />
          </section>

          {/* Live Feed (1/3) + Conversion Paths (2/3) */}
          {resolvedShop && (
            <section className="flex flex-col gap-5 lg:h-[520px] lg:flex-row">
              <div className="h-[420px] overflow-hidden lg:h-full lg:flex-[1]">
                <LiveFeed shopId={resolvedShop} />
              </div>
              <div className="h-[520px] overflow-hidden lg:h-full lg:flex-[2]">
                <ConversionPaths purchases={purchases} />
              </div>
            </section>
          )}

          {/* Revenue by Channel pie */}
          {!analyticsLoading && channels && (
            <section className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              <div style={{ height: 280 }}>
                <AttributionPieChart channels={channels} />
              </div>
            </section>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
