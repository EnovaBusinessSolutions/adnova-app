import { useState, useMemo } from 'react';
import { Users, Search, ChevronRight, ArrowUpRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useSessionExplorer } from '../hooks/useSessionExplorer';
import { formatCurrency, formatNumber } from '../utils/formatters';
import { channelColor, channelLabel } from '../utils/channelColors';
import type { SessionProfile } from '../types';

const PAGE_SIZE = 15;

interface Props {
  shopId: string;
  onSessionSelect: (sessionId: string) => void;
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch { return iso; }
}

interface ProfileRowProps {
  profile: SessionProfile;
  onClick: () => void;
}

function ProfileRow({ profile, onClick }: ProfileRowProps) {
  const hasSession = !!profile.recentSessionId;
  const channel = profile.lastCampaign ? 'meta' : null;

  return (
    <button
      onClick={onClick}
      disabled={!hasSession}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all',
        hasSession
          ? 'border-transparent hover:border-white/[0.06] hover:bg-white/[0.03]'
          : 'cursor-default border-transparent opacity-50',
      )}
    >
      {/* Avatar */}
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[10px] font-semibold text-white/50">
        {(profile.customerDisplayName ?? profile.profileLabel)?.[0]?.toUpperCase() ?? '?'}
      </div>

      {/* Identity */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-white/75">
          {profile.customerDisplayName ?? profile.profileLabel ?? profile.profileKey.slice(0, 14) + '…'}
        </p>
        <p className="truncate text-[10px] text-white/30">
          {profile.lastLandingPageUrl
            ? new URL(profile.lastLandingPageUrl).pathname
            : profile.profileType}
        </p>
      </div>

      {/* Stats */}
      <div className="hidden shrink-0 items-center gap-4 sm:flex">
        {channel && (
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: channelColor(channel) }}
            title={channelLabel(channel)}
          />
        )}
        <div className="text-right">
          <p className="text-[11px] font-semibold text-white/65">{formatCurrency(profile.totalRevenue)}</p>
          <p className="text-[9px] text-white/30">{formatNumber(profile.orderCount)} orders</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-white/40">{formatRelative(profile.lastSeenAt)}</p>
          <p className="text-[9px] text-white/25">{profile.sessionCount} sessions</p>
        </div>
      </div>

      {hasSession ? (
        <ChevronRight size={12} className="shrink-0 text-white/20" />
      ) : (
        <ArrowUpRight size={12} className="shrink-0 text-white/10" />
      )}
    </button>
  );
}

export function UserExplorerPanel({ shopId, onSessionSelect }: Props) {
  const { data, isLoading } = useSessionExplorer(shopId);
  const [query, setQuery] = useState('');
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    if (!data?.profiles) return [];
    if (!query.trim()) return data.profiles;
    const q = query.toLowerCase();
    return data.profiles.filter(
      (p) =>
        (p.customerDisplayName ?? '').toLowerCase().includes(q) ||
        p.profileLabel.toLowerCase().includes(q) ||
        p.profileKey.toLowerCase().includes(q),
    );
  }, [data?.profiles, query]);

  const visible = filtered.slice(0, displayLimit);
  const remaining = filtered.length - displayLimit;

  return (
    <div className="flex flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <Users size={13} className="text-white/40" />
          <span className="text-xs font-semibold text-white/70">User Explorer</span>
          {data?.summary && (
            <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-white/40">
              {formatNumber(data.summary.totalProfiles)} profiles
            </span>
          )}
        </div>

        {data?.summary && (
          <div className="hidden items-center gap-4 sm:flex">
            <div className="text-right">
              <p className="text-[10px] font-semibold text-white/55">{formatNumber(data.summary.totalOrders)}</p>
              <p className="text-[9px] text-white/25">orders</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold text-white/55">{formatCurrency(data.summary.totalRevenue)}</p>
              <p className="text-[9px] text-white/25">revenue</p>
            </div>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="border-b border-white/[0.04] px-4 py-2">
        <div className="relative">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/25" />
          <Input
            placeholder="Search by name, email…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setDisplayLimit(PAGE_SIZE); }}
            className="h-7 border-white/[0.06] bg-white/[0.02] pl-7 text-[11px] text-white/70 placeholder:text-white/20"
          />
        </div>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl bg-white/[0.04]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10">
            <Users size={20} className="text-white/15" />
            <p className="text-xs text-white/25">{query ? 'No profiles found' : 'No session data yet'}</p>
          </div>
        ) : (
          <div className="px-2 py-2">
            {visible.map((profile) => (
              <ProfileRow
                key={profile.profileKey}
                profile={profile}
                onClick={() => {
                  if (profile.recentSessionId) onSessionSelect(profile.recentSessionId);
                }}
              />
            ))}
            {remaining > 0 && (
              <button
                onClick={() => setDisplayLimit((l) => l + PAGE_SIZE)}
                className="mt-1 w-full rounded-lg border border-white/[0.06] bg-white/[0.02] py-1.5 text-[10px] text-white/40 transition-colors hover:bg-white/[0.05] hover:text-white/60"
              >
                Show more ({remaining} more)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
