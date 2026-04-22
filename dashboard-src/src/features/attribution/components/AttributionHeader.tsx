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
    <div className="sticky top-0 z-[30] border-b border-white/[0.06] bg-[#050508]/90 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-6">
        {/* Badge */}
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#B55CFF]/30 bg-[#B55CFF]/10 px-2.5 py-1 text-[10px] font-semibold tracking-wider text-[#D8B8FF]">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#B55CFF]/50" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#D8B8FF]" />
          </span>
          ATTRIBUTION
        </div>

        <div className="mx-1 hidden h-4 w-px bg-white/[0.08] sm:block" />

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
            Refresh
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={onExport}
            className="h-8 gap-1.5 border border-white/[0.08] bg-white/[0.03] px-3 text-xs text-white/60 hover:bg-white/[0.08] hover:text-white"
          >
            <Download size={12} />
            Export
          </Button>
        </div>
      </div>
    </div>
  );
}
