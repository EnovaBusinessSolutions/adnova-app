import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ParticleField } from "@/components/ParticleField";

type Step = 1 | 2 | 3;

export function OnboardingLayout({
  currentStep,
  children,
}: {
  currentStep: Step;
  children: ReactNode;
}) {
  const steps = [
    { num: 1, label: "Workspace" },
    { num: 2, label: "Tu perfil" },
    { num: 3, label: "Equipo" },
  ];

  return (
    <div className="adray-dashboard-shell adray-hero-bg relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* Hero grid + beam ambient overlays (igual que dashboard) */}
      <div className="adray-hero-grid" aria-hidden="true" />
      <div className="adray-hero-beam" aria-hidden="true" />

      {/* Floating particles ambient field */}
      <ParticleField variant="multiverse" count={32} />

      {/* Content stack on top of ambient layers */}
      <div className="relative z-10">
        {/* Stepper standalone, sin header. Centrado horizontalmente arriba del card. */}
        <div className="flex justify-center px-6 pt-10 md:pt-14">
          <div className="flex items-center gap-2 flex-wrap justify-center">
            {steps.map((s, idx) => {
              const isActive = s.num === currentStep;
              const isDone = s.num < currentStep;
              return (
                <div key={s.num} className="flex items-center gap-2">
                  <div
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition",
                      isActive && "border-[#b55cff]/45 bg-[rgba(181,92,255,0.12)] text-[#e6d2ff] shadow-[0_0_16px_rgba(181,92,255,0.22)]",
                      isDone && "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
                      !isActive && !isDone && "border-white/10 bg-white/[0.03] text-white/40"
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
        </div>

        {/* Main content area */}
        <main className="mx-auto max-w-2xl px-6 pt-8 pb-12 md:pt-10">
          <div className="adray-glass-apple animate-fade-in-up p-8 md:p-10">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
