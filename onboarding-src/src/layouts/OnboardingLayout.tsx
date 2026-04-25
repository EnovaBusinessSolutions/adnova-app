import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type Step = 1 | 2 | 3;

export function OnboardingLayout({
  currentStep,
  totalSteps = 3,
  children,
}: {
  currentStep: Step;
  totalSteps?: number;
  children: ReactNode;
}) {
  const steps = [
    { num: 1, label: "Workspace" },
    { num: 2, label: "Tu perfil" },
    { num: 3, label: "Equipo" },
  ];

  return (
    <div className="min-h-screen bg-bg text-white">
      <header className="border-b border-white/10 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-[#7c6df0]">
              <span className="text-sm font-bold text-white">A</span>
            </div>
            <span className="text-lg font-semibold">Adray</span>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            {steps.map((s, idx) => {
              const isActive = s.num === currentStep;
              const isDone = s.num < currentStep;
              return (
                <div key={s.num} className="flex items-center gap-2">
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
                      isActive && "border-accent/50 bg-accent/10 text-accent",
                      isDone && "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                      !isActive && !isDone && "border-white/10 bg-white/[0.02] text-white/40"
                    )}
                  >
                    {isDone ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    )}
                    <span>{s.label}</span>
                  </div>
                  {idx < steps.length - 1 && <div className="h-px w-6 bg-white/10" />}
                </div>
              );
            })}
          </div>

          <div className="text-xs text-white/40">
            Paso <span className="text-white">{currentStep}</span> de {totalSteps}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-12">{children}</main>
    </div>
  );
}
