import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { HistoricalJourneys } from './HistoricalJourneys';
import { SelectedJourney } from './SelectedJourney';
import type { RecentPurchase } from '../types';

const CHANNEL_TABS = [
  { value: 'all',          label: 'All' },
  { value: 'meta',         label: 'Meta' },
  { value: 'google',       label: 'Google' },
  { value: 'tiktok',       label: 'TikTok' },
  { value: 'organic',      label: 'Organic' },
  { value: 'unattributed', label: 'Other' },
];

interface ConversionPathsProps {
  purchases: RecentPurchase[];
}

function firstInChannel(purchases: RecentPurchase[], channel: string): RecentPurchase | null {
  if (channel === 'all') return purchases[0] ?? null;
  return purchases.find(
    (p) => (p.attributedChannel ?? 'unattributed').toLowerCase() === channel,
  ) ?? null;
}

export function ConversionPaths({ purchases }: ConversionPathsProps) {
  const [channelFilter, setChannelFilter] = useState('all');
  const [selected, setSelected] = useState<RecentPurchase | null>(() => purchases[0] ?? null);

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02]">
      {/* Header */}
      <div className="border-b border-white/[0.06] px-4 py-3">
        <p className="mb-2 text-xs font-semibold text-white/70">Conversion Paths</p>
        <Tabs value={channelFilter} onValueChange={(v) => { setChannelFilter(v); setSelected(firstInChannel(purchases, v)); }}>
          <TabsList className="h-7 gap-0.5 bg-white/[0.04] p-0.5">
            {CHANNEL_TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="h-6 px-2.5 text-[10px] data-[state=active]:bg-[#B55CFF]/20 data-[state=active]:text-[#D8B8FF] data-[state=active]:shadow-none"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* Content: list + detail side by side */}
      <div className="flex min-h-0 flex-1 gap-0">
        {/* Journey list */}
        <div className={`flex min-h-0 flex-col p-3 ${selected ? 'w-2/5 border-r border-white/[0.06]' : 'w-full'}`}>
          <HistoricalJourneys
            purchases={purchases}
            channelFilter={channelFilter}
            selectedId={selected?.orderId ?? null}
            onSelect={setSelected}
          />
        </div>

        {/* Selected journey detail */}
        {selected && (
          <div className="flex min-h-0 w-3/5 flex-col p-3">
            <SelectedJourney
              purchase={selected}
              onClose={() => setSelected(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
