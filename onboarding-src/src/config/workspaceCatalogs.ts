import {
  ShoppingBag, Zap, Target, Rocket, Lightbulb, Flame, Leaf, Gem,
  type LucideIcon,
} from "lucide-react";

export type WorkspaceIconKey =
  | "SHOPPING_BAG" | "LIGHTNING" | "TARGET" | "ROCKET"
  | "LIGHTBULB" | "FIRE" | "LEAF" | "DIAMOND";

export const WORKSPACE_ICONS: { key: WorkspaceIconKey; label: string; Icon: LucideIcon }[] = [
  { key: "SHOPPING_BAG", label: "Bag",       Icon: ShoppingBag },
  { key: "LIGHTNING",    label: "Lightning", Icon: Zap },
  { key: "TARGET",       label: "Target",    Icon: Target },
  { key: "ROCKET",       label: "Rocket",    Icon: Rocket },
  { key: "LIGHTBULB",    label: "Idea",      Icon: Lightbulb },
  { key: "FIRE",         label: "Fire",      Icon: Flame },
  { key: "LEAF",         label: "Leaf",      Icon: Leaf },
  { key: "DIAMOND",      label: "Diamond",   Icon: Gem },
];

export type IndustryVertical =
  | "ECOMMERCE_FASHION" | "ECOMMERCE_BEAUTY" | "ECOMMERCE_HOME_DECOR"
  | "ECOMMERCE_FOOD_BEVERAGE" | "ECOMMERCE_HEALTH_WELLNESS" | "ECOMMERCE_ELECTRONICS"
  | "ECOMMERCE_BABY_KIDS" | "ECOMMERCE_PETS" | "ECOMMERCE_SPORTS_OUTDOORS"
  | "ECOMMERCE_JEWELRY" | "ECOMMERCE_AUTOMOTIVE" | "DTC_SUBSCRIPTION"
  | "AGENCY" | "MARKETPLACE" | "OTHER";

export const INDUSTRY_VERTICALS: { key: IndustryVertical; label: string }[] = [
  { key: "ECOMMERCE_FASHION",         label: "Fashion & apparel" },
  { key: "ECOMMERCE_BEAUTY",          label: "Beauty & personal care" },
  { key: "ECOMMERCE_HOME_DECOR",      label: "Home & decor" },
  { key: "ECOMMERCE_FOOD_BEVERAGE",   label: "Food & beverage" },
  { key: "ECOMMERCE_HEALTH_WELLNESS", label: "Health & wellness" },
  { key: "ECOMMERCE_ELECTRONICS",     label: "Electronics" },
  { key: "ECOMMERCE_BABY_KIDS",       label: "Baby & kids" },
  { key: "ECOMMERCE_PETS",            label: "Pets" },
  { key: "ECOMMERCE_SPORTS_OUTDOORS", label: "Sports & outdoors" },
  { key: "ECOMMERCE_JEWELRY",         label: "Jewelry & accessories" },
  { key: "ECOMMERCE_AUTOMOTIVE",      label: "Automotive" },
  { key: "DTC_SUBSCRIPTION",          label: "DTC subscription" },
  { key: "AGENCY",                    label: "Agency" },
  { key: "MARKETPLACE",               label: "Marketplace" },
  { key: "OTHER",                     label: "Other" },
];

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

export type PrimaryFocus =
  | 'FOUNDER_CEO' | 'HEAD_OF_GROWTH' | 'HEAD_OF_MARKETING'
  | 'MARKETING_MANAGER' | 'PERFORMANCE_MARKETER' | 'ANALYTICS'
  | 'AGENCY' | 'ENGINEERING' | 'OTHER';

export const PRIMARY_FOCUS_OPTIONS: { key: PrimaryFocus; label: string }[] = [
  { key: 'FOUNDER_CEO',          label: 'Founder / CEO' },
  { key: 'HEAD_OF_GROWTH',       label: 'Head of Growth' },
  { key: 'HEAD_OF_MARKETING',    label: 'Head of Marketing' },
  { key: 'MARKETING_MANAGER',    label: 'Marketing Manager' },
  { key: 'PERFORMANCE_MARKETER', label: 'Performance Marketer' },
  { key: 'ANALYTICS',            label: 'Analytics' },
  { key: 'AGENCY',               label: 'Agency' },
  { key: 'ENGINEERING',          label: 'Engineering' },
  { key: 'OTHER',                label: 'Other' },
];

export const INVITABLE_ROLES: { key: 'ADMIN' | 'MEMBER'; label: string; description: string }[] = [
  {
    key: 'ADMIN',
    label: 'Admin',
    description: 'Settings, team and integrations.',
  },
  {
    key: 'MEMBER',
    label: 'Member',
    description: 'Use access. No team management.',
  },
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(s: string): boolean {
  return typeof s === 'string' && EMAIL_REGEX.test(s.trim());
}
