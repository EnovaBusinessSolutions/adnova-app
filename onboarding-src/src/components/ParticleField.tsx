// dashboard-src/src/components/ParticleField.tsx
//
// Ultra-subtle ambient particle field. Renders a small number of tiny,
// low-opacity particles that float across the viewport. Used as page-level
// background decoration (NOT inside cards). Pure CSS animations, zero deps.
//
// Default positioning is viewport-fixed (inset-0), so the particles cover
// the whole main content area behind the card/content blocks. The sidebar
// (z-50) stays above this layer.

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

// Palettes lean heavily on white/near-white with a subtle tint so particles
// read as "ambient dust" rather than colored confetti.
const VARIANT_COLORS: Record<ParticleVariant, string[]> = {
  multiverse: [
    "rgba(255,255,255,0.85)",
    "rgba(216,184,255,0.7)",   // pale purple
    "rgba(155,239,211,0.6)",   // pale emerald
    "rgba(190,219,242,0.65)",  // pale blue
  ],
  emerald: [
    "rgba(255,255,255,0.85)",
    "rgba(155,239,211,0.65)",
    "rgba(200,245,225,0.55)",
  ],
  purple: [
    "rgba(255,255,255,0.85)",
    "rgba(216,184,255,0.7)",
    "rgba(230,210,255,0.55)",
  ],
  blue: [
    "rgba(255,255,255,0.85)",
    "rgba(190,219,242,0.65)",
    "rgba(215,230,245,0.55)",
  ],
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
    bottomPct: rng() * -15, // start slightly below viewport
    size: 1 + rng() * 1.5, // 1.0–2.5 px — tiny
    duration: 28 + rng() * 32, // 28–60 s — slow, unhurried drift
    delay: -rng() * 50, // negative so they are already mid-drift at mount
    driftX: (rng() - 0.5) * 30, // -15 to +15 px horizontal sway
    opacity: 0.12 + rng() * 0.18, // 0.12–0.30 — very subtle
    color: pickFrom(palette, rng()),
  }));
}

/**
 * Ambient particle field pinned to the viewport. Render as a direct child
 * of your page root (after <DashboardLayout>) so it sits behind all content
 * in the main content area.
 *
 * The sidebar uses z-50, so these particles (z-0) never cover it.
 */
export function ParticleField({
  variant = "multiverse",
  count = 28,
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
        "pointer-events-none fixed inset-0 z-0 overflow-hidden",
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
            // Very soft glow — just a hint, not a halo
            boxShadow: `0 0 ${p.size * 1.5}px ${p.color}`,
            opacity: p.opacity,
            animation: `adray-particle-drift ${p.duration}s ease-in-out ${p.delay}s infinite`,
            ["--particle-drift-x" as string]: `${p.driftX}px`,
          }}
        />
      ))}
    </div>
  );
}

export default ParticleField;
