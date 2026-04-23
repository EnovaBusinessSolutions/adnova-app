import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AttributionModel } from '../types';

const MODEL_LABELS: Record<AttributionModel, string> = {
  last_touch: 'Last Click',
  first_touch: 'First Click',
  linear: 'Linear',
  time_decay: 'Time Decay',
  position: 'Position',
};

interface ModelSelectorProps {
  value: AttributionModel;
  onValueChange: (model: AttributionModel) => void;
}

export function ModelSelector({ value, onValueChange }: ModelSelectorProps) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as AttributionModel)}>
      <SelectTrigger className="h-8 w-[130px] border-white/[0.10] bg-white/[0.04] text-xs text-white/80 hover:bg-white/[0.07] focus:ring-[var(--adray-purple)]/40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="border-white/[0.10] bg-[#0f0f14]">
        {(Object.keys(MODEL_LABELS) as AttributionModel[]).map((m) => (
          <SelectItem key={m} value={m} className="text-xs text-white/80 focus:bg-[var(--adray-purple)]/10 focus:text-white">
            {MODEL_LABELS[m]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
