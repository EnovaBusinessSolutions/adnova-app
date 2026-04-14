import { useEffect, useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sidebar } from "@/components/Sidebar";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useSettings } from "@/hooks/useSettings";

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import {
  Save,
  Globe,
  Bell,
  Shield,
  Mail,
  Smartphone,
  Activity,
  RotateCcw,
  Loader2,
  ShoppingBag,
  Facebook,
  CreditCard,
  AlertCircle,
  Unplug,
  Trash2,
  BarChart3,
  CheckCircle2,
  LockKeyhole,
  Settings2,
} from "lucide-react";

/* =========================
 * Helpers API
 * ========================= */
async function apiJson<T>(url: string) {
  const r = await fetch(url, { credentials: "include" });
  const txt = await r.text();
  if (!r.ok) throw new Error(txt || `HTTP ${r.status}`);
  return JSON.parse(txt) as T;
}

async function apiPost<T>(url: string, body: any) {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(txt || `HTTP ${r.status}`);
  return (txt ? JSON.parse(txt) : {}) as T;
}

/* =========================
 * Types
 * ========================= */
type OnboardingStatus = {
  ok: boolean;
  status: {
    meta: {
      connected: boolean;
      availableCount: number;
      selectedCount: number;
      requiredSelection: boolean;
      selected: string[];
      defaultAccountId: string | null;
      maxSelect: number;
    };
    googleAds: {
      connected: boolean;
      availableCount: number;
      selectedCount: number;
      requiredSelection: boolean;
      selected: string[];
      defaultCustomerId: string | null;
      maxSelect: number;
    };
    ga4: {
      connected: boolean;
      availableCount: number;
      selectedCount: number;
      requiredSelection: boolean;
      selected: string[];
      defaultPropertyId: string | null;
      maxSelect: number;
    };
    shopify: { connected: boolean };
  };
};

type SettingsTab = "notifications" | "security" | "integrations";
type DisconnectKind = "meta" | "google_ads" | "ga4" | "shopify";

/* =========================
 * Query helpers
 * ========================= */
function getQS() {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function prettyPlanLabel(plan: string) {
  const p = (plan || "free").toLowerCase();
  if (p === "pro") return "Pro";
  if (p === "growth") return "Growth";
  if (p === "enterprise") return "Enterprise";
  return "Free";
}

function prettySubStatus(status: string) {
  if (!status || status === "—") return "Inactive";
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function StatusPill({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
      Connected
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/60">
      <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
      Not connected
    </span>
  );
}

function OverviewStat({
  label,
  value,
  icon: Icon,
  glow,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  glow: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-80", glow)} />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-white/42">{label}</div>
          <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.05] p-2.5">
          <Icon className="h-4 w-4 text-white/75" />
        </div>
      </div>
    </div>
  );
}

function SectionShell({
  title,
  icon: Icon,
  children,
  right,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden rounded-[26px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(168,85,247,0.10),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.025))] shadow-[0_20px_70px_rgba(0,0,0,0.32)] backdrop-blur-xl">
      <CardHeader className="border-b border-white/10 bg-white/[0.02] py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
              <Icon className="h-5 w-5 text-violet-200" />
            </div>
            <CardTitle className="text-xl font-semibold text-white">{title}</CardTitle>
          </div>
          {right}
        </div>
      </CardHeader>

      <CardContent className="p-5 md:p-6">{children}</CardContent>
    </Card>
  );
}

function IntegrationRow({
  icon: Icon,
  iconClassName,
  name,
  subLabel,
  connected,
  onDisconnect,
  comingSoon = false,
  accent = "from-violet-500/15 via-fuchsia-500/10 to-cyan-400/10",
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClassName?: string;
  name: string;
  subLabel?: string;
  connected: boolean;
  onDisconnect?: () => void;
  comingSoon?: boolean;
  accent?: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition-all duration-300 hover:border-white/15 hover:bg-white/[0.045]">
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-75", accent)} />
      <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <Icon className={cn("h-5 w-5 text-white/80", iconClassName)} />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <p className="text-base font-semibold text-white">{name}</p>
              {comingSoon ? (
                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-0.5 text-[11px] font-medium text-white/50">
                  Soon
                </span>
              ) : null}
            </div>
            {subLabel ? <p className="mt-1 text-sm text-white/52">{subLabel}</p> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <StatusPill connected={connected} />

          {connected && onDisconnect ? (
            <Button
              size="sm"
              onClick={onDisconnect}
              className="rounded-xl border border-rose-400/15 bg-rose-400/10 px-4 text-rose-100 hover:bg-rose-400/15 hover:text-white"
              title={`Disconnect ${name}`}
            >
              <Unplug className="mr-2 h-4 w-4" />
              Disconnect
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  icon: Icon,
  iconClassName,
  title,
  subtitle,
  checked,
  onCheckedChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconClassName?: string;
  title: string;
  subtitle?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 pr-3">
          <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
            <Icon className={cn("h-4 w-4 text-white/80", iconClassName)} />
          </div>

          <div>
            <p className="text-base font-semibold text-white">{title}</p>
            {subtitle ? <p className="mt-1 text-sm text-white/52">{subtitle}</p> : null}
          </div>
        </div>

        <div className="shrink-0">
          <Switch checked={checked} onCheckedChange={onCheckedChange} />
        </div>
      </div>
    </div>
  );
}

const Settings = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { settings, updateSetting, saveSettings, resetSettings, isLoading, hasChanges } = useSettings();

  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const qs = getQS();
    const tab = (qs.get("tab") || "").toLowerCase();
    if (tab === "security") return "security";
    if (tab === "notifications") return "notifications";
    return "integrations";
  });

  /* =========================
   * Integrations (status)
   * ========================= */
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);

  const refreshConnections = async () => {
    setLoadingConnections(true);
    try {
      const st = await apiJson<OnboardingStatus>("/api/onboarding/status");
      setStatus(st);
      return st;
    } catch {
      setStatus(null);
      return null;
    } finally {
      setLoadingConnections(false);
    }
  };

  useEffect(() => {
    refreshConnections();
  }, []);

  const st = status?.status;

  const connections = useMemo(() => {
    return {
      shopify: !!st?.shopify?.connected,
      meta: !!st?.meta?.connected,
      googleAds: !!st?.googleAds?.connected,
      ga4: !!st?.ga4?.connected,
    };
  }, [st]);

  const connectedCount = useMemo(() => {
    return [connections.shopify, connections.meta, connections.googleAds, connections.ga4].filter(Boolean).length;
  }, [connections]);

  /* =========================
   * Subscription / plan
   * ========================= */
  const [me, setMe] = useState<{ plan?: string; subscription?: { status?: string } } | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMe = async () => {
      try {
        const r = await fetch("/api/me", { credentials: "include" });
        if (!r.ok) return;
        const j = await r.json();
        setMe(j || null);
      } catch {}
    };
    fetchMe();
  }, []);

  const openBillingPortal = async () => {
    setPortalError(null);
    setPortalLoading(true);
    try {
      const r = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data?.url) {
        throw new Error(data?.error || "Could not open the billing portal");
      }
      window.location.href = data.url;
    } catch (e: any) {
      setPortalError(e?.message || "Could not open the billing portal");
    } finally {
      setPortalLoading(false);
    }
  };

  const subStatus = (me?.subscription?.status || "").toLowerCase() || "—";
  const currentPlan = (me?.plan || "free").toLowerCase();

  /* =========================
   * Disconnect-only
   * ========================= */
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnectKind, setDisconnectKind] = useState<DisconnectKind>("google_ads");
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const disconnectLabel = useMemo(() => {
    if (disconnectKind === "meta") return "Meta Ads";
    if (disconnectKind === "google_ads") return "Google Ads";
    if (disconnectKind === "ga4") return "Google Analytics (GA4)";
    return "Shopify";
  }, [disconnectKind]);

  const openDisconnect = (kind: DisconnectKind) => {
    setDisconnectError(null);
    setDisconnectKind(kind);
    setDisconnectOpen(true);
  };

  const doDisconnect = async () => {
    setDisconnectError(null);
    setDisconnectLoading(true);
    try {
      await apiPost("/api/onboarding/reset", { target: disconnectKind, source: "settings" });
      await refreshConnections();
      setDisconnectOpen(false);
    } catch (e: any) {
      setDisconnectError(e?.message || "Could not disconnect. Please try again.");
      console.error(e);
    } finally {
      setDisconnectLoading(false);
    }
  };

  /* =========================
   * Save / reset
   * ========================= */
  const handleSave = async () => {
    await saveSettings();
  };

  const handleReset = () => {
    resetSettings();
  };

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-[#06070b] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(168,85,247,0.16),transparent_24%),radial-gradient(circle_at_top_right,rgba(34,211,238,0.10),transparent_18%),radial-gradient(circle_at_bottom,rgba(99,102,241,0.10),transparent_24%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:34px_34px]" />

      <div className="relative z-10 hidden md:block">
        <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      </div>

      <div className={cn("relative z-10 flex-1 transition-all duration-300 ml-0", sidebarOpen ? "md:ml-64" : "md:ml-16")}>
        <div className="mx-auto max-w-7xl p-4 pb-24 md:p-6 md:pb-8">
          <div className="relative overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(192,132,252,0.10),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.45)] backdrop-blur-xl md:p-7">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                <div className="max-w-2xl">
                  <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-400/15 bg-fuchsia-400/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-fuchsia-200">
                    <Settings2 className="h-3.5 w-3.5" />
                    Settings
                  </div>

                  <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-5xl">
                    Clean control for your{" "}
                    <span className="bg-gradient-to-r from-fuchsia-300 via-violet-200 to-cyan-200 bg-clip-text text-transparent">
                      Adray workspace
                    </span>
                  </h1>

                  {hasChanges ? (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-amber-400/15 bg-amber-400/10 px-4 py-2 text-sm text-amber-100">
                      <AlertCircle className="h-4 w-4 text-amber-300" />
                      Unsaved changes
                    </div>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:w-[430px]">
                  <OverviewStat
                    label="Apps"
                    value={`${connectedCount}/4`}
                    icon={CheckCircle2}
                    glow="from-emerald-500/15 via-cyan-400/10 to-transparent"
                  />
                  <OverviewStat
                    label="Plan"
                    value={prettyPlanLabel(currentPlan)}
                    icon={CreditCard}
                    glow="from-fuchsia-500/15 via-violet-500/10 to-transparent"
                  />
                  <OverviewStat
                    label="Security"
                    value={settings.twoFactorAuth ? "2FA" : "Standard"}
                    icon={LockKeyhole}
                    glow="from-indigo-500/15 via-violet-500/10 to-transparent"
                  />
                </div>
              </div>

              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SettingsTab)} className="space-y-6">
                <TabsList className="grid h-auto w-full grid-cols-3 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5 backdrop-blur-sm">
                  <TabsTrigger
                    value="integrations"
                    className="h-12 rounded-xl text-sm font-medium text-white/65 transition data-[state=active]:bg-[linear-gradient(135deg,rgba(168,85,247,0.20),rgba(255,255,255,0.07))] data-[state=active]:text-white data-[state=active]:shadow-[0_10px_30px_rgba(168,85,247,0.14)]"
                  >
                    <Globe className="mr-2 h-4 w-4" />
                    Integrations
                  </TabsTrigger>

                  <TabsTrigger
                    value="security"
                    className="h-12 rounded-xl text-sm font-medium text-white/65 transition data-[state=active]:bg-[linear-gradient(135deg,rgba(168,85,247,0.20),rgba(255,255,255,0.07))] data-[state=active]:text-white data-[state=active]:shadow-[0_10px_30px_rgba(168,85,247,0.14)]"
                  >
                    <Shield className="mr-2 h-4 w-4" />
                    Security
                  </TabsTrigger>

                  <TabsTrigger
                    value="notifications"
                    className="h-12 rounded-xl text-sm font-medium text-white/65 transition data-[state=active]:bg-[linear-gradient(135deg,rgba(168,85,247,0.20),rgba(255,255,255,0.07))] data-[state=active]:text-white data-[state=active]:shadow-[0_10px_30px_rgba(168,85,247,0.14)]"
                  >
                    <Bell className="mr-2 h-4 w-4" />
                    Notifications
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="integrations" className="space-y-6">
                  <SectionShell
                    title="Integrations"
                    icon={Globe}
                    right={
                      <Button
                        variant="outline"
                        onClick={refreshConnections}
                        disabled={loadingConnections}
                        className="h-10 rounded-xl border-white/10 bg-white/[0.04] px-4 text-white hover:bg-white/[0.07]"
                      >
                        {loadingConnections ? (
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Refreshing...
                          </span>
                        ) : (
                          "Refresh"
                        )}
                      </Button>
                    }
                  >
                    <div className="grid gap-4">
                      <IntegrationRow
                        icon={ShoppingBag}
                        iconClassName="text-emerald-200"
                        name="Shopify"
                        subLabel="Commerce sync"
                        connected={connections.shopify}
                        comingSoon
                        accent="from-emerald-500/10 via-emerald-400/6 to-transparent"
                        onDisconnect={connections.shopify ? () => openDisconnect("shopify") : undefined}
                      />

                      <IntegrationRow
                        icon={Facebook}
                        iconClassName="text-fuchsia-200"
                        name="Meta Ads"
                        subLabel="Paid media data"
                        connected={connections.meta}
                        accent="from-fuchsia-500/15 via-violet-500/10 to-transparent"
                        onDisconnect={connections.meta ? () => openDisconnect("meta") : undefined}
                      />

                      <IntegrationRow
                        icon={BarChart3}
                        iconClassName="text-cyan-200"
                        name="Google Ads"
                        subLabel="Campaign intelligence"
                        connected={connections.googleAds}
                        accent="from-cyan-500/12 via-sky-400/8 to-transparent"
                        onDisconnect={connections.googleAds ? () => openDisconnect("google_ads") : undefined}
                      />

                      <IntegrationRow
                        icon={Activity}
                        iconClassName="text-violet-200"
                        name="Google Analytics"
                        subLabel="Traffic and events"
                        connected={connections.ga4}
                        accent="from-violet-500/15 via-indigo-400/10 to-transparent"
                        onDisconnect={connections.ga4 ? () => openDisconnect("ga4") : undefined}
                      />
                    </div>

                    <div className="mt-5 rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(168,85,247,0.08),rgba(255,255,255,0.03))] p-4 md:p-5">
                      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-center gap-4">
                          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                            <CreditCard className="h-5 w-5 text-fuchsia-200" />
                          </div>

                          <div>
                            <p className="text-base font-semibold text-white">Subscription</p>
                            <p className="mt-1 text-sm text-white/58">
                              {prettyPlanLabel(currentPlan)} · {prettySubStatus(subStatus)}
                            </p>
                            {portalError ? (
                              <p className="mt-2 flex items-center gap-2 text-sm text-rose-200">
                                <AlertCircle className="h-4 w-4 text-rose-300" />
                                {portalError}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        <Button
                          onClick={openBillingPortal}
                          disabled={portalLoading}
                          className="h-11 rounded-xl border border-fuchsia-400/15 bg-[linear-gradient(135deg,rgba(192,132,252,0.20),rgba(34,211,238,0.12))] px-5 text-white shadow-[0_14px_40px_rgba(168,85,247,0.16)] hover:opacity-95"
                        >
                          {portalLoading ? (
                            <span className="inline-flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Opening...
                            </span>
                          ) : (
                            "Manage plan"
                          )}
                        </Button>
                      </div>
                    </div>
                  </SectionShell>
                </TabsContent>

                <TabsContent value="security" className="space-y-6">
                  <SectionShell title="Security" icon={Shield}>
                    <div className="grid gap-4">
                      <ToggleRow
                        icon={Shield}
                        iconClassName="text-violet-200"
                        title="Two-factor authentication"
                        subtitle="Extra protection"
                        checked={settings.twoFactorAuth}
                        onCheckedChange={(checked) => updateSetting("twoFactorAuth", checked)}
                      />

                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:p-5">
                        <div className="mb-3">
                          <p className="text-base font-semibold text-white">Session timeout</p>
                          <p className="mt-1 text-sm text-white/52">Session duration</p>
                        </div>

                        <Select
                          value={settings.sessionTimeout}
                          onValueChange={(value) => updateSetting("sessionTimeout", value)}
                        >
                          <SelectTrigger className="h-12 rounded-xl border-white/10 bg-white/[0.04] text-white">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1 hour</SelectItem>
                            <SelectItem value="8">8 hours</SelectItem>
                            <SelectItem value="24">24 hours</SelectItem>
                            <SelectItem value="168">1 week</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </SectionShell>
                </TabsContent>

                <TabsContent value="notifications" className="space-y-6">
                  <SectionShell title="Notifications" icon={Bell}>
                    <div className="grid gap-4">
                      <ToggleRow
                        icon={Mail}
                        iconClassName="text-fuchsia-200"
                        title="Email notifications"
                        subtitle="Important alerts"
                        checked={settings.emailNotifications}
                        onCheckedChange={(checked) => updateSetting("emailNotifications", checked)}
                      />

                      <ToggleRow
                        icon={Smartphone}
                        iconClassName="text-cyan-200"
                        title="Push notifications"
                        subtitle="Real-time updates"
                        checked={settings.pushNotifications}
                        onCheckedChange={(checked) => updateSetting("pushNotifications", checked)}
                      />

                      <ToggleRow
                        icon={Activity}
                        iconClassName="text-violet-200"
                        title="Weekly reports"
                        subtitle="Key metrics summary"
                        checked={settings.weeklyReports}
                        onCheckedChange={(checked) => updateSetting("weeklyReports", checked)}
                      />
                    </div>
                  </SectionShell>
                </TabsContent>
              </Tabs>

              <div className="flex flex-col-reverse gap-3 border-t border-white/10 pt-6 md:flex-row md:items-center md:justify-between">
                <Button
                  variant="outline"
                  onClick={handleReset}
                  className="h-11 rounded-xl border-white/10 bg-white/[0.03] px-5 text-white hover:bg-white/[0.06]"
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset
                </Button>

                <Button
                  onClick={handleSave}
                  disabled={isLoading || !hasChanges}
                  className="h-11 rounded-xl border border-fuchsia-400/15 bg-[linear-gradient(135deg,rgba(168,85,247,0.24),rgba(34,211,238,0.14))] px-5 text-white shadow-[0_16px_50px_rgba(168,85,247,0.18)] hover:opacity-95 disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {isLoading ? "Saving..." : "Save settings"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 md:hidden">
        <MobileBottomNav />
      </div>

      <Dialog open={disconnectOpen} onOpenChange={(v) => !disconnectLoading && setDisconnectOpen(v)}>
        <DialogContent className="max-w-lg overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(244,63,94,0.10),transparent_30%),linear-gradient(180deg,rgba(10,10,15,0.97),rgba(14,14,20,0.97))] text-white shadow-[0_30px_100px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Unplug className="h-4 w-4 text-rose-300" />
              Disconnect {disconnectLabel}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-2xl border border-rose-400/15 bg-rose-400/10 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 text-rose-300" />
                <div className="text-sm">
                  <div className="font-medium text-white">Sensitive action</div>
                  <div className="mt-1 leading-6 text-white/68">
                    This removes tokens, saved selections, discovered accounts, and pixel or conversion selections for{" "}
                    <b>{disconnectLabel}</b>.
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/58">
              Your Adray account will remain active.
            </div>

            {disconnectError ? (
              <div className="rounded-xl border border-rose-400/15 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
                {disconnectError}
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setDisconnectOpen(false)}
              disabled={disconnectLoading}
              className="rounded-xl border border-white/10 bg-white/[0.05] text-white hover:bg-white/[0.08]"
            >
              Cancel
            </Button>

            <Button
              onClick={doDisconnect}
              disabled={disconnectLoading}
              className="rounded-xl border border-rose-400/15 bg-rose-400/15 text-rose-100 hover:bg-rose-400/20"
              title="Disconnect"
            >
              {disconnectLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Disconnecting...
                </span>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Disconnect
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Settings;