import { RefreshCw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ShopSwitcher } from './ShopSwitcher';
import { ModelSelector } from './ModelSelector';
import { DateRangePicker } from './DateRangePicker';
import type { Shop, AttributionModel, RangePreset } from '../types';

interface AttributionHeaderProps {
  shops: Shop[];
  shopsLoading: boolean;
  shop: string;
  onShopChange: (shop: string) => void;
  model: AttributionModel;
  onModelChange: (model: AttributionModel) => void;
  range: RangePreset | 'custom';
  start?: string;
  end?: string;
  onRangeChange: (r: RangePreset | 'custom') => void;
  onStartChange: (s: string | null) => void;
  onEndChange: (e: string | null) => void;
  onRefresh: () => void;
  onExport: () => void;
  isRefreshing?: boolean;
}

export function AttributionHeader({
  shops,
  shopsLoading,
  shop,
  onShopChange,
  model,
  onModelChange,
  range,
  start,
  end,
  onRangeChange,
  onStartChange,
  onEndChange,
  onRefresh,
  onExport,
  isRefreshing,
}: AttributionHeaderProps) {
  return (
    <div className="border-b border-[var(--adray-line)] bg-[rgba(5,5,8,0.82)] backdrop-blur-xl supports-[backdrop-filter]:bg-[rgba(5,5,8,0.72)] sm:sticky sm:top-0 sm:z-[30]">
      {/* ─── Mobile layout (<sm): 3 rows premium ─── */}
      <div className="flex flex-col gap-2.5 px-3 py-2.5 sm:hidden">
        {/* Row 1: Badge ATTRIBUTION + action buttons */}
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--adray-purple)]/30 bg-[var(--adray-purple)]/10 px-2.5 py-1 text-[10px] font-semibold tracking-wider text-[#D8B8FF]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--adray-purple)]/50" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#D8B8FF]" />
            </span>
            ATTRIBUTION
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing}
              aria-label="Refresh data"
              className="h-9 w-9 gap-0 border border-white/[0.08] bg-white/[0.03] p-0 text-white/65 hover:bg-white/[0.08] hover:text-white"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onExport}
              aria-label="Export data"
              className="h-9 w-9 gap-0 border border-white/[0.08] bg-white/[0.03] p-0 text-white/65 hover:bg-white/[0.08] hover:text-white"
            >
              <Download size={14} />
            </Button>
          </div>
        </div>

        {/* Row 2: Shop selector full-width */}
        <ShopSwitcher
          shops={shops}
          value={shop}
          onValueChange={onShopChange}
          loading={shopsLoading}
        />

        {/* Row 3: Date range + Model selectors in a 2-col grid */}
        <div className="grid grid-cols-2 gap-2">
          <DateRangePicker
            range={range}
            start={start}
            end={end}
            onRangeChange={onRangeChange}
            onStartChange={onStartChange}
            onEndChange={onEndChange}
          />
          <ModelSelector value={model} onValueChange={onModelChange} />
        </div>
      </div>

      {/* ─── Desktop layout (sm+): unchanged from phase B ─── */}
      <div className="hidden flex-wrap items-center gap-2 px-4 py-2.5 sm:flex md:px-6">
        {/* Badge */}
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--adray-purple)]/30 bg-[var(--adray-purple)]/10 px-2.5 py-1 text-[10px] font-semibold tracking-wider text-[#D8B8FF]">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--adray-purple)]/50" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#D8B8FF]" />
          </span>
          ATTRIBUTION
        </div>

        <div className="mx-1 h-4 w-px bg-[var(--adray-line)]" />

        {/* Controls */}
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <ShopSwitcher
            shops={shops}
            value={shop}
            onValueChange={onShopChange}
            loading={shopsLoading}
          />

          <DateRangePicker
            range={range}
            start={start}
            end={end}
            onRangeChange={onRangeChange}
            onStartChange={onStartChange}
            onEndChange={onEndChange}
          />

          <ModelSelector value={model} onValueChange={onModelChange} />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="h-8 gap-1.5 border border-white/[0.08] bg-white/[0.03] px-3 text-xs text-white/60 hover:bg-white/[0.08] hover:text-white"
          >
            <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onExport}
            className="h-8 gap-1.5 border border-white/[0.08] bg-white/[0.03] px-3 text-xs text-white/60 hover:bg-white/[0.08] hover:text-white"
          >
            <Download size={12} />
            <span>Export</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
