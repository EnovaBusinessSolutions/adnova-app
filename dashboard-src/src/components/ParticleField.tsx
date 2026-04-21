// dashboard-src/src/components/ParticleField.tsx
//
// Lightweight CSS-only floating particle field used as ambient background
// decoration in premium Adray panels. No external dependencies — just DOM
// elements animated via the `adray-particle-drift` keyframes defined in
// index.css.
//
// Each panel picks a variant (multiverse, emerald, purple, blue) to match
// its visual identity and give the user the feeling of stepping into a
// different "world" per panel.

import { useMemo } from "react";

export type ParticleVariant = "multiverse" | "emerald" | "purple" | "blue";

type ParticleFieldProps = {
  variant?: ParticleVariant;
  count?: number;
  className?: string;
};

type Particle = {
  id: number;
  leftPct: number;
  bottomPct: number;
  size: number;
  duration: number;
  delay: number;
  driftX: number;
  opacity: number;
  color: string;
};

const VARIANT_COLORS: Record<ParticleVariant, string[]> = {
  multiverse: ["#B55CFF", "#4FE3C1", "#7CC8FF", "#D8B8FF"],
  emerald: ["#4FE3C1", "#9BEFD3"],
  purple: ["#B55CFF", "#D8B8FF"],
  blue: ["#7CC8FF", "#BEDBF2"],
};

function pickFrom<T>(arr: T[], rnd: number): T {
  const idx = Math.floor(rnd * arr.length) % arr.length;
  return arr[idx];
}

function buildParticles(
  variant: ParticleVariant,
  count: number,
  seed: string
): Particle[] {
  // Deterministic-ish random per (variant + mount). We use a simple LCG so
  // particles look similar across SSR/CSR and between re-renders of the same
  // component instance, but differ per panel variant.
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  const rng = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };

  const palette = VARIANT_COLORS[variant];

  return Array.from({ length: count }, (_, i) => ({
    id: i,
    leftPct: rng() * 100,
    bottomPct: rng() * -20, // start slightly below the viewport
    size: 2 + rng() * 3, // 2–5 px
    duration: 22 + rng() * 28, // 22–50 s
    delay: -rng() * 40, // negative so particles are mid-animation at mount
    driftX: (rng() - 0.5) * 40, // -20 to +20 px horizontal sway
    opacity: 0.25 + rng() * 0.45, // 0.25–0.70
    color: pickFrom(palette, rng()),
  }));
}

export function ParticleField({
  variant = "multiverse",
  count = 32,
  className = "",
}: ParticleFieldProps) {
  const particles = useMemo(
    () => buildParticles(variant, count, variant),
    [variant, count]
  );

  return (
    <div
      aria-hidden="true"
      className={[
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      ].join(" ")}
    >
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.leftPct}%`,
            bottom: `${p.bottomPct}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.color,
            boxShadow: `0 0 ${p.size * 2.5}px ${p.color}`,
            opacity: p.opacity,
            animation: `adray-particle-drift ${p.duration}s ease-in-out ${p.delay}s infinite`,
            // CSS custom property for per-particle horizontal drift
            ["--particle-drift-x" as string]: `${p.driftX}px`,
          }}
        />
      ))}
    </div>
  );
}

export default ParticleField;
