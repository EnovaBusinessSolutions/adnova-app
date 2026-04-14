import { RefreshCcw, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ATTRIBUTION_MODEL_OPTIONS,
  RANGE_OPTIONS,
  type RangePreset,
} from "@/lib/attribution";
import type { AttributionModel } from "@/types/attribution";

type AttributionFiltersProps = {
  shop: string;
  availableShops: string[];
  rangePreset: RangePreset;
  start: string;
  end: string;
  allTime: boolean;
  attributionModel: AttributionModel;
  loading?: boolean;
  fetching?: boolean;
  onShopChange: (value: string) => void;
  onRangePresetChange: (value: RangePreset) => void;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  onAttributionModelChange: (value: AttributionModel) => void;
  onRefresh: () => void;
};

export function AttributionFilters({
  shop,
  availableShops,
  rangePreset,
  start,
  end,
  allTime,
  attributionModel,
  loading,
  fetching,
  onShopChange,
  onRangePresetChange,
  onStartChange,
  onEndChange,
  onAttributionModelChange,
  onRefresh,
}: AttributionFiltersProps) {
  return (
    <section className="sticky top-4 z-20 overflow-hidden rounded-[34px] border border-[#B55CFF]/20 bg-[linear-gradient(180deg,rgba(21,18,26,0.96)_0%,rgba(15,12,20,0.94)_100%)] px-5 py-5 shadow-[0_24px_60px_rgba(0,0,0,0.34)] backdrop-blur-[18px] md:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 rounded-[14px] border border-[#B55CFF]/14 bg-[rgba(44,37,48,0.62)] px-4 py-3 text-[#E8B8FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
          <Sparkles className="h-4 w-4" />
          <span className="font-ulm text-[1.15rem] tracking-[-0.03em] text-[#F4ECFF]">AdRay</span>
          <span className="text-sm text-white/50">Analytics</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {shop ? (
            <Badge className="border-[#4FE3C1]/20 bg-[#4FE3C1]/10 px-3 py-1.5 text-[#DFFBF3]">
              {shop}
            </Badge>
          ) : null}
          <Badge className="border-white/10 bg-white/[0.05] px-3 py-1.5 text-white/75">
            {fetching ? "Refreshing..." : loading ? "Loading..." : "Ready"}
          </Badge>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.1fr_0.8fr_0.9fr_0.9fr_0.9fr_auto]">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-white/45">Store</p>
          <Select value={shop || undefined} onValueChange={onShopChange} disabled={!availableShops.length}>
            <SelectTrigger className="h-12 rounded-[18px] border-[#B55CFF]/18 bg-[rgba(44,37,48,0.48)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <SelectValue placeholder="Select store" />
            </SelectTrigger>
            <SelectContent className="border-white/10 bg-[#0E0B16] text-white">
              {availableShops.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {entry}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-white/45">Range</p>
          <Select value={rangePreset} onValueChange={(value) => onRangePresetChange(value as RangePreset)}>
            <SelectTrigger className="h-12 rounded-[18px] border-[#B55CFF]/18 bg-[rgba(44,37,48,0.48)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <SelectValue placeholder="Select range" />
            </SelectTrigger>
            <SelectContent className="border-white/10 bg-[#0E0B16] text-white">
              {RANGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-white/45">Start</p>
          <Input
            type="date"
            value={start}
            disabled={allTime}
            onChange={(event) => onStartChange(event.target.value)}
            className="h-12 rounded-[18px] border-[#B55CFF]/18 bg-[rgba(44,37,48,0.48)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] disabled:opacity-40"
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-white/45">End</p>
          <Input
            type="date"
            value={end}
            disabled={allTime}
            onChange={(event) => onEndChange(event.target.value)}
            className="h-12 rounded-[18px] border-[#B55CFF]/18 bg-[rgba(44,37,48,0.48)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] disabled:opacity-40"
          />
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-white/45">Model</p>
          <Select
            value={attributionModel}
            onValueChange={(value) => onAttributionModelChange(value as AttributionModel)}
          >
            <SelectTrigger className="h-12 rounded-[18px] border-[#B55CFF]/18 bg-[rgba(44,37,48,0.48)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <SelectValue placeholder="Attribution model" />
            </SelectTrigger>
            <SelectContent className="border-white/10 bg-[#0E0B16] text-white">
              {ATTRIBUTION_MODEL_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end">
          <Button
            type="button"
            onClick={onRefresh}
            className="h-12 w-full rounded-[18px] border border-[#B55CFF]/20 bg-[linear-gradient(135deg,rgba(181,92,255,0.22)_0%,rgba(157,91,255,0.14)_100%)] px-4 text-white shadow-[0_16px_30px_rgba(0,0,0,0.18),inset_0_1px_0_rgba(255,255,255,0.05)] hover:bg-[linear-gradient(135deg,rgba(181,92,255,0.34)_0%,rgba(157,91,255,0.24)_100%)]"
          >
            <RefreshCcw className={`h-4 w-4 ${fetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>
    </section>
  );
}
