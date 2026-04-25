// dashboard-src/src/config/workspaceCatalogs.ts
//
// Mirror de onboarding-src/src/config/workspaceCatalogs.ts.
// Mantener sincronizado si agregas íconos o verticales nuevos.

import {
  ShoppingBag, Zap, Target, Rocket, Lightbulb, Flame, Leaf, Gem,
  type LucideIcon,
} from "lucide-react";

export type WorkspaceIconKey =
  | "SHOPPING_BAG" | "LIGHTNING" | "TARGET" | "ROCKET"
  | "LIGHTBULB" | "FIRE" | "LEAF" | "DIAMOND";

export const WORKSPACE_ICONS: Record<WorkspaceIconKey, LucideIcon> = {
  SHOPPING_BAG: ShoppingBag,
  LIGHTNING: Zap,
  TARGET: Target,
  ROCKET: Rocket,
  LIGHTBULB: Lightbulb,
  FIRE: Flame,
  LEAF: Leaf,
  DIAMOND: Gem,
};

export function getWorkspaceIcon(key: string | null | undefined): LucideIcon {
  if (!key) return ShoppingBag;
  return WORKSPACE_ICONS[key as WorkspaceIconKey] || ShoppingBag;
}
