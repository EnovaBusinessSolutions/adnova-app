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

// === Industry verticals (mirror de onboarding-src) ===
export type IndustryVertical =
  | "ECOMMERCE_FASHION" | "ECOMMERCE_BEAUTY" | "ECOMMERCE_HOME_DECOR"
  | "ECOMMERCE_FOOD_BEVERAGE" | "ECOMMERCE_HEALTH_WELLNESS" | "ECOMMERCE_ELECTRONICS"
  | "ECOMMERCE_BABY_KIDS" | "ECOMMERCE_PETS" | "ECOMMERCE_SPORTS_OUTDOORS"
  | "ECOMMERCE_JEWELRY" | "ECOMMERCE_AUTOMOTIVE" | "DTC_SUBSCRIPTION"
  | "AGENCY" | "MARKETPLACE" | "OTHER";

export const INDUSTRY_VERTICALS: { key: IndustryVertical; label: string }[] = [
  { key: "ECOMMERCE_FASHION",         label: "Moda y ropa" },
  { key: "ECOMMERCE_BEAUTY",          label: "Belleza y cuidado personal" },
  { key: "ECOMMERCE_HOME_DECOR",      label: "Hogar y decoración" },
  { key: "ECOMMERCE_FOOD_BEVERAGE",   label: "Comida y bebida" },
  { key: "ECOMMERCE_HEALTH_WELLNESS", label: "Salud y bienestar" },
  { key: "ECOMMERCE_ELECTRONICS",     label: "Electrónica" },
  { key: "ECOMMERCE_BABY_KIDS",       label: "Bebés y niños" },
  { key: "ECOMMERCE_PETS",            label: "Mascotas" },
  { key: "ECOMMERCE_SPORTS_OUTDOORS", label: "Deportes y aire libre" },
  { key: "ECOMMERCE_JEWELRY",         label: "Joyería y accesorios" },
  { key: "ECOMMERCE_AUTOMOTIVE",      label: "Automotriz" },
  { key: "DTC_SUBSCRIPTION",          label: "Suscripción DTC" },
  { key: "AGENCY",                    label: "Agencia" },
  { key: "MARKETPLACE",               label: "Marketplace" },
  { key: "OTHER",                     label: "Otro" },
];

export const ICON_OPTIONS_FULL: { key: string; label: string }[] = [
  { key: "SHOPPING_BAG", label: "Bolsa" },
  { key: "LIGHTNING",    label: "Rayo" },
  { key: "TARGET",       label: "Objetivo" },
  { key: "ROCKET",       label: "Cohete" },
  { key: "LIGHTBULB",   label: "Idea" },
  { key: "FIRE",         label: "Fuego" },
  { key: "LEAF",         label: "Hoja" },
  { key: "DIAMOND",      label: "Diamante" },
];

// === Roles ===
export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER";

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};

export const INVITABLE_ROLES: { key: "ADMIN" | "MEMBER"; label: string; description: string }[] = [
  { key: "ADMIN",  label: "Admin",  description: "Configuración, equipo e integraciones." },
  { key: "MEMBER", label: "Member", description: "Acceso de uso. Sin gestión de equipo." },
];

// === Slug helpers ===
const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "login", "logout", "signup", "settings",
  "dashboard", "billing", "mcp", "public", "www", "support", "help",
  "blog", "docs", "integrations", "team", "workspace", "workspaces",
  "invitations", "invitation", "onboarding", "me",
]);

export function deriveSlug(input: string): string {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export function isValidSlugFormat(slug: string): boolean {
  if (!slug || slug.length > 48) return false;
  if (RESERVED_SLUGS.has(slug)) return false;
  return SLUG_REGEX.test(slug);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(s: string): boolean {
  return typeof s === "string" && EMAIL_REGEX.test(s.trim());
}
