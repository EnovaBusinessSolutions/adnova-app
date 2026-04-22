import { X, Video, Globe, Clock, ArrowRight, ExternalLink, Zap } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useSessionDetail } from '../hooks/useSessionDetail';
import { useRecording } from '../hooks/useRecording';
import { formatCurrency, formatNumber } from '../utils/formatters';
import { channelColor, channelLabel } from '../utils/channelColors';

interface Props {
  shopId: string;
  sessionId: string | null;
  recordingId?: string | null;
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatTs(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-MX', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date(iso));
  } catch { return iso; }
}

const EVENT_COLORS: Record<string, string> = {
  page_view: 'bg-white/20',
  view_item: 'bg-blue-400/60',
  add_to_cart: 'bg-yellow-400/60',
  begin_checkout: 'bg-orange-400/60',
  purchase: 'bg-emerald-400/60',
};

function eventDot(name: string) {
  return EVENT_COLORS[name] ?? 'bg-white/10';
}

interface StatChipProps { label: string; value: string | number }
function StatChip({ label, value }: StatChipProps) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-white/[0.04] px-3 py-2">
      <span className="text-[13px] font-semibold text-white/75">{value}</span>
      <span className="text-[9px] text-white/30">{label}</span>
    </div>
  );
}

export function SessionDetailPanel({ shopId, sessionId, recordingId, onClose }: Props) {
  const { data, isLoading } = useSessionDetail(shopId, sessionId);
  const { data: rec } = useRecording(shopId, recordingId ?? data?.session?.sessionId ?? null);

  const s = data?.session;
  const m = data?.metrics;
  const j = data?.journey;
  const channel = j?.attribution?.channel;

  return (
    <Sheet open={!!sessionId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="flex w-full flex-col border-white/[0.06] bg-[#0a0a0f] p-0 sm:max-w-[520px]"
      >
        {/* Header */}
        <SheetHeader className="border-b border-white/[0.06] px-5 py-4">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-sm font-semibold text-white/80">Session Detail</SheetTitle>
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-white/30 hover:bg-white/[0.06] hover:text-white/60"
            >
              <X size={14} />
            </button>
          </div>
          {s && (
            <p className="truncate font-mono text-[10px] text-white/25">{s.sessionId}</p>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent">
          {isLoading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl bg-white/[0.04]" />
              ))}
            </div>
          ) : !data ? (
            <div className="flex h-48 items-center justify-center">
              <p className="text-xs text-white/25">Session not found</p>
            </div>
          ) : (
            <div className="space-y-4 p-5">

              {/* Attribution + duration */}
              <div className="flex flex-wrap items-center gap-2">
                {channel && (
                  <Badge
                    variant="outline"
                    className="border-white/[0.08] px-2 py-0.5 text-[10px]"
                    style={{ borderColor: `${channelColor(channel)}50`, color: channelColor(channel) }}
                  >
                    {channelLabel(channel)}
                  </Badge>
                )}
                {j?.attribution?.confidence != null && (
                  <span className="text-[10px] text-white/30">
                    {Math.round(j.attribution.confidence * 100)}% confidence
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1 text-[10px] text-white/30">
                  <Clock size={10} />
                  {formatDuration(s!.sessionDurationSeconds)}
                </span>
              </div>

              {/* Metrics row */}
              {m && (
                <div className="grid grid-cols-4 gap-2">
                  <StatChip label="Events" value={formatNumber(m.totalEvents)} />
                  <StatChip label="Pages" value={formatNumber(m.uniquePages)} />
                  <StatChip label="Products" value={formatNumber(m.uniqueProducts)} />
                  <StatChip label="Revenue" value={m.revenue > 0 ? formatCurrency(m.revenue) : '—'} />
                </div>
              )}

              {/* Landing + exit */}
              {(j?.entryPage || j?.exitPage) && (
                <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] p-3">
                  <p className="mb-2 text-[10px] font-semibold text-white/40">Journey</p>
                  <div className="flex items-center gap-2 overflow-hidden">
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <Globe size={10} className="shrink-0 text-white/25" />
                      <span className="truncate text-[10px] text-white/55">{j.entryPage ?? '—'}</span>
                    </div>
                    <ArrowRight size={10} className="shrink-0 text-white/20" />
                    <span className="truncate text-[10px] text-white/35">{j.exitPage ?? j.entryPage ?? '—'}</span>
                  </div>
                </div>
              )}

              {/* UTMs */}
              {(s?.utmSource || s?.utmCampaign || s?.utmMedium) && (
                <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] p-3">
                  <p className="mb-2 text-[10px] font-semibold text-white/40">UTM Parameters</p>
                  <div className="space-y-1">
                    {[
                      ['Source', s.utmSource],
                      ['Medium', s.utmMedium],
                      ['Campaign', s.utmCampaign],
                      ['Content', s.utmContent],
                      ['Term', s.utmTerm],
                    ].filter(([, v]) => v).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2">
                        <span className="w-16 text-[9px] text-white/25">{k}</span>
                        <span className="truncate text-[10px] text-white/55">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Click IDs */}
              {(s?.fbclid || s?.gclid || s?.ttclid) && (
                <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] p-3">
                  <p className="mb-2 text-[10px] font-semibold text-white/40">Click IDs</p>
                  <div className="space-y-1">
                    {[
                      ['fbclid', s.fbclid],
                      ['gclid', s.gclid],
                      ['ttclid', s.ttclid],
                    ].filter(([, v]) => v).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2">
                        <span className="w-14 text-[9px] text-white/25">{k}</span>
                        <span className="truncate font-mono text-[9px] text-white/40">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recording */}
              {rec?.recording && (
                <div className="rounded-xl border border-[#4FE3C1]/20 bg-[#4FE3C1]/5 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Video size={11} className="text-[#4FE3C1]" />
                    <span className="text-[10px] font-semibold text-[#4FE3C1]">Session Recording</span>
                    <span className={cn(
                      'ml-auto rounded-full px-1.5 py-0.5 text-[8px] font-semibold',
                      rec.recording.status === 'READY'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-white/10 text-white/40',
                    )}>
                      {rec.recording.status}
                    </span>
                  </div>
                  <div className="mb-2 flex gap-4 text-[10px] text-white/40">
                    {rec.recording.durationMs != null && (
                      <span>{formatDuration(Math.round(rec.recording.durationMs / 1000))}</span>
                    )}
                    {rec.recording.cartValue != null && (
                      <span>Cart {formatCurrency(rec.recording.cartValue)}</span>
                    )}
                  </div>
                  {rec.presignedUrl && rec.recording.status === 'READY' && (
                    <a
                      href={rec.presignedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-[10px] text-[#4FE3C1] hover:underline"
                    >
                      <ExternalLink size={10} />
                      Watch replay
                    </a>
                  )}
                </div>
              )}

              {/* Timeline */}
              {data.timeline?.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-semibold text-white/40">Event Timeline</p>
                  <div className="space-y-0.5">
                    {data.timeline.map((ev, i) => (
                      <div key={ev.eventId ?? i} className="flex items-start gap-2.5 py-1">
                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${eventDot(ev.eventName)}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-medium text-white/60">{ev.eventName}</span>
                            {ev.revenue > 0 && (
                              <span className="flex items-center gap-0.5 text-[9px] text-emerald-400">
                                <Zap size={8} />
                                {formatCurrency(ev.revenue, ev.currency)}
                              </span>
                            )}
                          </div>
                          {ev.pageUrl && (
                            <p className="truncate text-[9px] text-white/25" title={ev.pageUrl}>
                              {ev.pageUrl.replace(/^https?:\/\/[^/]+/, '')}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 text-[9px] text-white/20">{formatTs(ev.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
