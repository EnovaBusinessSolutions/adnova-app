import { useState, useRef, useEffect, type ReactNode } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PremiumSelectOption<T extends string> {
  key: T;
  label: string;
  description?: string;
  icon?: ReactNode;
}

export interface PremiumSelectProps<T extends string> {
  options: PremiumSelectOption<T>[];
  value: T | "";
  onChange: (v: T) => void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
  /** Si true, muestra una checkmark al lado del item seleccionado en el dropdown */
  showCheckmark?: boolean;
}

export function PremiumSelect<T extends string>({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  className,
  showCheckmark = true,
}: PremiumSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.key === value);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function escHandler(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[rgba(10,10,14,0.65)] px-4 py-3 text-left text-sm text-foreground transition-all duration-200",
          "hover:border-[#b55cff]/35 hover:bg-[rgba(14,12,22,0.78)]",
          "focus:border-[#b55cff]/55 focus:outline-none focus:ring-2 focus:ring-[#b55cff]/22",
          open && "border-[#b55cff]/55 ring-2 ring-[#b55cff]/22 shadow-[0_0_28px_rgba(181,92,255,0.18)]",
          disabled && "cursor-not-allowed opacity-50",
          !selected && "text-white/35"
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {selected?.icon && <span className="flex-none">{selected.icon}</span>}
          <span className="truncate">{selected?.label || placeholder}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 flex-none text-white/45 transition-transform duration-200",
            open && "rotate-180 text-[#b55cff]"
          )}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            "absolute left-0 right-0 z-50 mt-2 max-h-72 overflow-y-auto rounded-xl p-1.5",
            "border border-[#b55cff]/30 bg-[rgba(14,11,22,0.99)] backdrop-blur-2xl",
            "shadow-[0_30px_70px_rgba(0,0,0,0.55),0_0_30px_rgba(181,92,255,0.18)]",
            "animate-fade-in no-scrollbar"
          )}
        >
          {options.map((opt) => {
            const isSelected = opt.key === value;
            return (
              <button
                key={opt.key}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.key);
                  setOpen(false);
                }}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-150",
                  isSelected
                    ? "bg-[rgba(181,92,255,0.22)] text-white shadow-[inset_0_0_0_1px_rgba(181,92,255,0.45)]"
                    : "text-white/90 hover:bg-[rgba(181,92,255,0.16)] hover:text-white"
                )}
              >
                {opt.icon && <span className="flex-none">{opt.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{opt.label}</span>
                  {opt.description && (
                    <span className="block truncate text-xs text-white/60 group-hover:text-white/75">
                      {opt.description}
                    </span>
                  )}
                </span>
                {showCheckmark && isSelected && (
                  <Check className="h-4 w-4 flex-none text-[#b55cff]" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
