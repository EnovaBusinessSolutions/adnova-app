import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type AttributionPanelProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  kicker?: string;
};

export function AttributionPanel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  kicker = "Attribution",
}: AttributionPanelProps) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[30px] border border-[#2C2530] bg-[linear-gradient(180deg,rgba(21,18,26,0.96)_0%,rgba(13,11,19,0.98)_100%)] shadow-[0_24px_60px_rgba(0,0,0,0.34)]",
        className
      )}
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#B55CFF]/35 to-transparent" />
      <header className="flex items-start justify-between gap-4 border-b border-white/8 bg-white/[0.03] px-5 py-5 md:px-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#BCA6D7]">
            {kicker}
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-white">{title}</h2>
          {subtitle ? <p className="mt-2 text-sm leading-6 text-white/65">{subtitle}</p> : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      <div className={cn("px-5 py-5 md:px-6 md:py-6", bodyClassName)}>{children}</div>
    </section>
  );
}
