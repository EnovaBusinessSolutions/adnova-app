import { useState } from 'react';
import { Pause, Play, Radio, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLiveFeed } from '../hooks/useLiveFeed';
import { LiveFeedItem } from './LiveFeedItem';

const PAGE_SIZE = 20;

interface LiveFeedProps {
  shopId: string;
}

export function LiveFeed({ shopId }: LiveFeedProps) {
  const { events, paused, bufferedCount, connectionState, togglePause, loadMore } =
    useLiveFeed(shopId);
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);

  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';
  const displayed = events.slice(0, displayLimit);
  const remaining = events.length - displayLimit;

  return (
    <div className="futuristic-panel flex h-full flex-col">
      {/* Header */}
      <div className="relative z-[1] flex items-center justify-between border-b border-[var(--adray-line)] px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2">
          <Radio size={13} className="text-white/40" />
          <span className="text-xs font-semibold text-white/70">Live Feed</span>
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              isConnected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' :
              isConnecting ? 'animate-pulse bg-yellow-400' :
              'bg-red-400',
            )}
          />
        </div>

        <div className="flex items-center gap-1.5">
          {bufferedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={loadMore}
              className="h-7 gap-1 px-2 text-[10px] text-[var(--adray-cyan)] hover:bg-[var(--adray-cyan)]/10 sm:h-6"
            >
              <ChevronDown size={10} />
              {bufferedCount} new
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={togglePause}
            className="h-7 gap-1 px-2 text-[10px] text-white/50 hover:bg-white/[0.05] hover:text-white sm:h-6"
          >
            {paused ? <Play size={10} /> : <Pause size={10} />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      </div>

      {/* Events list */}
      <div className="relative z-[1] min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12">
            <Radio size={20} className="text-white/15" />
            <p className="text-xs text-white/25">
              {isConnecting ? 'Connecting…' : 'Waiting for events'}
            </p>
          </div>
        ) : (
          <>
            {displayed.map((event, i) => (
              <LiveFeedItem key={event.eventId ?? `${event.type}-${i}`} event={event} />
            ))}
            {remaining > 0 && (
              <div className="px-3 py-2">
                <button
                  onClick={() => setDisplayLimit((l) => l + PAGE_SIZE)}
                  className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] py-1.5 text-[10px] text-white/40 transition-colors hover:bg-white/[0.05] hover:text-white/60"
                >
                  Show more ({remaining} more)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
