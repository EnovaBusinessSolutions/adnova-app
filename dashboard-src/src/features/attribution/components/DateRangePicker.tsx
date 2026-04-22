import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import type { RangePreset } from '../types';

const RANGE_LABELS: Record<string, string> = {
  '7': 'Last 7 days',
  '14': 'Last 14 days',
  '30': 'Last 30 days',
  '90': 'Last 90 days',
  custom: 'Custom',
};

const PRESETS: (RangePreset | 'custom')[] = [7, 14, 30, 90, 'custom'];

interface DateRangePickerProps {
  range: RangePreset | 'custom';
  start?: string;
  end?: string;
  onRangeChange: (r: RangePreset | 'custom') => void;
  onStartChange: (s: string | null) => void;
  onEndChange: (e: string | null) => void;
}

export function DateRangePicker({
  range,
  start,
  end,
  onRangeChange,
  onStartChange,
  onEndChange,
}: DateRangePickerProps) {
  return (
    <div className="flex items-center gap-2">
      <Select
        value={String(range)}
        onValueChange={(v) => onRangeChange(v === 'custom' ? 'custom' : (Number(v) as RangePreset))}
      >
        <SelectTrigger className="h-8 w-[130px] border-white/[0.10] bg-white/[0.04] text-xs text-white/80 hover:bg-white/[0.07] focus:ring-[#B55CFF]/40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-white/[0.10] bg-[#0f0f14]">
          {PRESETS.map((p) => (
            <SelectItem key={String(p)} value={String(p)} className="text-xs text-white/80 focus:bg-[#B55CFF]/10 focus:text-white">
              {RANGE_LABELS[String(p)]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {range === 'custom' && (
        <>
          <Input
            type="date"
            value={start ?? ''}
            onChange={(e) => onStartChange(e.target.value || null)}
            className="h-8 w-[130px] border-white/[0.10] bg-white/[0.04] text-xs text-white/80 [color-scheme:dark]"
          />
          <span className="text-xs text-white/30">→</span>
          <Input
            type="date"
            value={end ?? ''}
            onChange={(e) => onEndChange(e.target.value || null)}
            className="h-8 w-[130px] border-white/[0.10] bg-white/[0.04] text-xs text-white/80 [color-scheme:dark]"
          />
        </>
      )}
    </div>
  );
}
