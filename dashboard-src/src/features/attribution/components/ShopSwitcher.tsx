import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Shop } from '../types';

interface ShopSwitcherProps {
  shops: Shop[];
  value: string;
  onValueChange: (shop: string) => void;
  loading?: boolean;
}

export function ShopSwitcher({ shops, value, onValueChange, loading }: ShopSwitcherProps) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={loading || shops.length === 0}>
      <SelectTrigger className="h-9 w-full border-white/[0.10] bg-white/[0.04] text-xs text-white/80 hover:bg-white/[0.07] focus:ring-[var(--adray-purple)]/40 sm:h-8 sm:w-[220px]">
        <SelectValue placeholder={loading ? 'Loading stores…' : 'Select store'} />
      </SelectTrigger>
      <SelectContent className="border-white/[0.10] bg-[#0f0f14]">
        {shops.map((s) => (
          <SelectItem key={s.shop} value={s.shop} className="text-xs text-white/80 focus:bg-[var(--adray-purple)]/10 focus:text-white">
            {s.shop}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
