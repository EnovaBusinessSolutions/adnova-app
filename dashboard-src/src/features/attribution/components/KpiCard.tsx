import { type ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

type KpiAccent = 'default' | 'meta' | 'google' | 'tiktok' | 'warn';

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  icon?: ReactNode;
  loading?: boolean;
  accent?: KpiAccent;
  className?: string;
}

const ACCENT_BORDER: Record<KpiAccent, string> = {
  default: 'border-[var(--adray-line)]',
  meta:    'border-[#1877F2]/25',
  google:  'border-[#4285F4]/25',
  tiktok:  'border-white/[0.12]',
  warn:    'border-yellow-500/30',
};

const ACCENT_GLOW: Record<KpiAccent, string> = {
  default: '',
  meta:    'shadow-[0_0_20px_rgba(24,119,242,0.06)]',
  google:  'shadow-[0_0_20px_rgba(66,133,244,0.06)]',
  tiktok:  '',
  warn:    'shadow-[0_0_20px_rgba(234,179,8,0.06)]',
};

export function KpiCard({ label, value, sub, icon, loading, accent = 'default', className }: KpiCardProps) {
  return (
    <Card
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-[var(--adray-surface-2)] backdrop-blur-md transition-all duration-200 hover:bg-[rgba(255,255,255,0.035)] hover:shadow-[var(--adray-shadow-lg)]',
        ACCENT_BORDER[accent],
        ACCENT_GLOW[accent],
        className,
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-medium leading-tight text-white/45">{label}</p>
          {icon != null && (
            <span className="mt-0.5 shrink-0 text-white/25">{icon}</span>
          )}
        </div>

        {loading ? (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-5 w-20 bg-white/[0.06]" />
            <Skeleton className="h-3 w-14 bg-white/[0.04]" />
          </div>
        ) : (
          <>
            <p className="mt-2 text-[1.15rem] font-semibold leading-tight tracking-tight text-white">
              {value}
            </p>
            {sub != null && (
              <p className="mt-1 text-[11px] leading-tight text-white/35">{sub}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
