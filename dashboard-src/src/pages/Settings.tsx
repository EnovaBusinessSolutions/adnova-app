// dashboard-src/src/pages/Settings.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sidebar } from "@/components/Sidebar";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useSettings } from "@/hooks/useSettings";

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  Search,
  Facebook,
  CreditCard,
  AlertCircle,
  Settings2,
  Unplug,
  Trash2,
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
  return JSON.parse(txt) as T;
}

const MAX_SELECT = 1;

const digitsOnly = (s: string) => String(s || "").replace(/[^\d]/g, "");
const normActDigits = (s: string) => String(s || "").replace(/^act_/, "").trim();
const normGA4 = (s: string) => {
  const raw = String(s || "").trim();
  const digits = raw.replace(/^properties\//, "").replace(/[^\d]/g, "");
  return digits || raw.replace(/^properties\//, "").trim();
};

/* =========================
 * Tipos mínimos (tolerantes)
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

type MetaAccountsResp = {
  ok: boolean;
  accounts?: Array<{ id?: string; account_id?: string; name?: string; account_name?: string }>;
  requiredSelection?: boolean;
  selectionRequired?: boolean;
  selectedAccountIds?: string[];
  defaultAccountId?: string | null;
};

type GoogleStatusResp = {
  ad_accounts?: Array<{ id: string; name?: string; descriptiveName?: string }>;
  customers?: Array<{ id: string; descriptiveName?: string; name?: string }>;
  gaProperties?: Array<{ propertyId?: string; name?: string; displayName?: string }>;
};

type PickerState = {
  meta: Set<string>;
  googleAds: Set<string>;
  ga4: Set<string>;
};

function getQS() {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

function replaceQS(next: URLSearchParams) {
  const qs = next.toString();
  const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
  window.history.replaceState({}, "", url);
}

type DisconnectKind = "google" | "meta" | "shopify";

type DisconnectPreview = {
  ok?: boolean;
  auditsToDelete?: number;
  breakdown?: Record<string, number>;
  message?: string;
};

const Settings = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { settings, updateSetting, saveSettings, resetSettings, isLoading, hasChanges } = useSettings();

  const [activeTab, setActiveTab] = useState<"notifications" | "security" | "integrations">(() => {
    const qs = getQS();
    const tab = (qs.get("tab") || "").toLowerCase();
    const selector = qs.get("selector");
    if (tab === "integrations" || selector === "1") return "integrations";
    return "notifications";
  });

  /* =========================
   * Integraciones (estado real)
   * ========================= */
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);

  const connections = useMemo(() => {
    const st = status?.status;
    const googleAny = !!(st?.googleAds?.connected || st?.ga4?.connected);
    return {
      shopify: !!st?.shopify?.connected,
      google: googleAny,
      meta: !!st?.meta?.connected,
    };
  }, [status]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const [metaOptions, setMetaOptions] = useState<Array<{ idDigits: string; label: string }>>([]);
  const [googleAdsOptions, setGoogleAdsOptions] = useState<Array<{ idDigits: string; label: string }>>([]);
  const [ga4Options, setGa4Options] = useState<Array<{ rawId: string; label: string }>>([]);

  const [pickerSel, setPickerSel] = useState<PickerState>({
    meta: new Set(),
    googleAds: new Set(),
    ga4: new Set(),
  });

  const requiredSelection = useMemo(() => {
    const st = status?.status;
    return {
      meta: !!st?.meta?.requiredSelection,
      googleAds: !!st?.googleAds?.requiredSelection,
      ga4: !!st?.ga4?.requiredSelection,
    };
  }, [status]);

  const mustPickAnything = useMemo(() => {
    return requiredSelection.meta || requiredSelection.googleAds || requiredSelection.ga4;
  }, [requiredSelection]);

  const refreshConnections = async () => {
    setLoadingConnections(true);
    try {
      const st = await apiJson<OnboardingStatus>("/api/onboarding/status");
      setStatus(st);
    } catch {
      setStatus(null);
    } finally {
      setLoadingConnections(false);
    }
  };

  useEffect(() => {
    refreshConnections();
  }, []);

  /* =========================
   * Suscripción / plan
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
      } catch {
        // no-op
      }
    };
    fetchMe();
  }, []);

  const handleSave = async () => {
    await saveSettings();
  };

  const handleReset = () => {
    resetSettings();
  };

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
        throw new Error(data?.error || "No se pudo abrir el portal de facturación");
      }
      window.location.href = data.url;
    } catch (e: any) {
      setPortalError(e?.message || "No se pudo abrir el portal");
    } finally {
      setPortalLoading(false);
    }
  };

  const subStatus = (me?.subscription?.status || "").toLowerCase() || "—";
  const currentPlan = (me?.plan || "gratis").toLowerCase();

  /* =========================
   * Acciones Integraciones
   * ========================= */
  const connectReturnTo = "/dashboard/settings?tab=integrations";
  const connectGoogleUrl = `/auth/google/connect?returnTo=${encodeURIComponent(connectReturnTo)}`;
  const connectMetaUrl = `/auth/meta/login?returnTo=${encodeURIComponent(connectReturnTo)}`;

  /* =========================
   * Disconnect (confirm modal + preview + ack)
   * ========================= */
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [disconnectKind, setDisconnectKind] = useState<DisconnectKind>("google");
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const [disconnectPreviewLoading, setDisconnectPreviewLoading] = useState(false);
  const [disconnectPreview, setDisconnectPreview] = useState<DisconnectPreview | null>(null);
  const [disconnectAck, setDisconnectAck] = useState(false);

  const disconnectLabel = useMemo(() => {
    if (disconnectKind === "google") return "Google (Ads + GA4)";
    if (disconnectKind === "meta") return "Meta (Facebook/Instagram Ads)";
    return "Shopify";
  }, [disconnectKind]);

  const disconnectEndpoint = useMemo(() => {
    if (disconnectKind === "google") return "/auth/google/disconnect";
    if (disconnectKind === "meta") return "/auth/meta/disconnect";
    return "/auth/shopify/disconnect";
  }, [disconnectKind]);

  const disconnectPreviewEndpoint = useMemo(() => {
    if (disconnectKind === "google") return "/auth/google/disconnect/preview";
    if (disconnectKind === "meta") return "/auth/meta/disconnect/preview";
    return "/auth/shopify/disconnect/preview";
  }, [disconnectKind]);

  const openDisconnect = async (kind: DisconnectKind) => {
    setDisconnectError(null);
    setDisconnectPreview(null);
    setDisconnectAck(false);

    setDisconnectKind(kind);
    setDisconnectOpen(true);

    const previewUrl =
      kind === "google"
        ? "/auth/google/disconnect/preview"
        : kind === "meta"
        ? "/auth/meta/disconnect/preview"
        : "/auth/shopify/disconnect/preview";

    if (kind === "google" || kind === "meta") {
      setDisconnectPreviewLoading(true);
      try {
        const p = await apiJson<DisconnectPreview>(previewUrl);
        setDisconnectPreview(p || null);
      } catch {
        setDisconnectPreview(null);
      } finally {
        setDisconnectPreviewLoading(false);
      }
    }
  };

  const doDisconnect = async () => {
    setDisconnectError(null);
    setDisconnectLoading(true);
    try {
      if (pickerOpen) setPickerOpen(false);

      await apiPost(disconnectEndpoint, {});
      await refreshConnections();

      const next = getQS();
      if (next.get("selector") === "1") {
        next.delete("selector");
        replaceQS(next);
      }

      setDisconnectOpen(false);
    } catch (e: any) {
      setDisconnectError(e?.message || "No se pudo desconectar. Intenta de nuevo.");
      console.error(e);
    } finally {
      setDisconnectLoading(false);
    }
  };

  /* =========================
   * Picker
   * ========================= */
  const openPicker = async () => {
    setPickerError(null);
    setPickerLoading(true);

    try {
      let metaOpts: Array<{ idDigits: string; label: string }> = [];

      try {
        const meta = await apiJson<MetaAccountsResp>("/auth/meta/accounts");
        const rawMeta = (meta.accounts || []) as any[];
        metaOpts = rawMeta
          .map((a) => {
            const digits = normActDigits(a.account_id || a.id || "");
            const label = a.name || a.account_name || (digits ? `act_${digits}` : "");
            return digits ? { idDigits: digits, label } : null;
          })
          .filter(Boolean) as Array<{ idDigits: string; label: string }>;
      } catch {
        try {
          const metaLegacy = await apiJson<any>("/api/meta/accounts");
          const rawMeta = (metaLegacy.ad_accounts_all || metaLegacy.ad_accounts || metaLegacy.accounts || []) as any[];
          metaOpts = rawMeta
            .map((a) => {
              const digits = normActDigits(a.account_id || a.id || "");
              const label = a.name || a.account_name || (digits ? `act_${digits}` : "");
              return digits ? { idDigits: digits, label } : null;
            })
            .filter(Boolean) as Array<{ idDigits: string; label: string }>;
        } catch {
          metaOpts = [];
        }
      }

      let adsOpts: Array<{ idDigits: string; label: string }> = [];
      let ga4Opts: Array<{ rawId: string; label: string }> = [];

      try {
        const g = await apiJson<GoogleStatusResp>("/auth/google/status");
        const rawAds = Array.isArray(g.ad_accounts) ? g.ad_accounts : Array.isArray(g.customers) ? g.customers : [];
        adsOpts = rawAds
          .map((a: any) => {
            const idDigits = digitsOnly(a.id || "");
            const label = a.name || a.descriptiveName || `Cuenta ${idDigits}`;
            return idDigits ? { idDigits, label } : null;
          })
          .filter(Boolean) as Array<{ idDigits: string; label: string }>;

        const rawGa4 = Array.isArray(g.gaProperties) ? g.gaProperties : [];
        ga4Opts = rawGa4
          .map((p: any) => {
            const rawId = String(p.propertyId || p.name || "").trim();
            const label = p.displayName || p.name || rawId;
            return rawId ? { rawId, label } : null;
          })
          .filter(Boolean) as Array<{ rawId: string; label: string }>;
      } catch {
        adsOpts = [];
        ga4Opts = [];
      }

      setMetaOptions(metaOpts);
      setGoogleAdsOptions(adsOpts);
      setGa4Options(ga4Opts);

      const st = status?.status;

      const metaSel = (st?.meta?.selected || []).map(normActDigits).slice(0, MAX_SELECT);
      const adsSel = (st?.googleAds?.selected || []).map(digitsOnly).slice(0, MAX_SELECT);
      const ga4Sel = (st?.ga4?.selected || []).map(normGA4).slice(0, MAX_SELECT);

      const ga4Map = new Map(ga4Opts.map((x) => [normGA4(x.rawId), x.rawId]));
      const ga4RawSelected = ga4Sel.map((id) => ga4Map.get(id) || id);

      setPickerSel({
        meta: new Set(metaSel),
        googleAds: new Set(adsSel),
        ga4: new Set(ga4RawSelected),
      });

      setPickerOpen(true);
    } catch (e: any) {
      setPickerError("No se pudo cargar la lista de cuentas. Intenta de nuevo.");
      console.error(e);
    } finally {
      setPickerLoading(false);
    }
  };

  const canSavePicker = useMemo(() => {
    if (!mustPickAnything) return true;
    if (requiredSelection.meta && pickerSel.meta.size === 0) return false;
    if (requiredSelection.googleAds && pickerSel.googleAds.size === 0) return false;
    if (requiredSelection.ga4 && pickerSel.ga4.size === 0) return false;
    return true;
  }, [pickerSel, requiredSelection, mustPickAnything]);

  const toggleOne = (kind: keyof PickerState, value: string) => {
    setPickerSel((prev) => {
      const next = new Set(prev[kind]);
      if (next.has(value)) next.delete(value);
      else {
        if (next.size >= MAX_SELECT) return prev;
        next.add(value);
      }
      return { ...prev, [kind]: next };
    });
  };

  const savePicker = async () => {
    if (!canSavePicker) return;
    setPickerError(null);
    setPickerLoading(true);

    try {
      const tasks: Promise<any>[] = [];

      if (requiredSelection.meta) {
        const ids = Array.from(pickerSel.meta).slice(0, MAX_SELECT);
        if (ids.length) tasks.push(apiPost("/auth/meta/accounts/selection", { accountIds: ids }));
      }

      if (requiredSelection.googleAds) {
        const ids = Array.from(pickerSel.googleAds).slice(0, MAX_SELECT);
        if (ids.length) {
          tasks.push(
            (async () => {
              try {
                await apiPost("/api/google/ads/insights/accounts/selection", { accountIds: ids });
              } catch {
                await apiPost("/auth/google/accounts/selection", { customerIds: ids });
              }
            })()
          );
        }
      }

      if (requiredSelection.ga4) {
        const ids = Array.from(pickerSel.ga4).slice(0, MAX_SELECT);
        if (ids.length) tasks.push(apiPost("/api/google/analytics/selection", { propertyIds: ids }));
      }

      await Promise.all(tasks);

      setPickerOpen(false);
      await refreshConnections();
    } catch (e: any) {
      setPickerError("Ocurrió un error guardando la selección. Intenta de nuevo.");
      console.error(e);
    } finally {
      setPickerLoading(false);
    }
  };

  /* =========================
   * AUTO-ABRIR MODAL AL REGRESAR DEL OAUTH
   * ========================= */
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (loadingConnections) return;

    const qs = getQS();
    const selector = qs.get("selector") === "1";

    if (selector && activeTab !== "integrations") {
      setActiveTab("integrations");
    }

    const shouldOpen = selector || mustPickAnything;
    if (!shouldOpen) return;

    autoOpenedRef.current = true;

    openPicker().finally(() => {
      const next = getQS();
      if (next.get("selector") === "1") {
        next.delete("selector");
        replaceQS(next);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingConnections, mustPickAnything]);

  /* =========================
   * UI: preview auditorías
   * ========================= */
  const previewCount = Number(disconnectPreview?.auditsToDelete || 0);
  const previewBreakdown = disconnectPreview?.breakdown || null;

  const requireAuditAck = useMemo(() => {
    return disconnectKind === "google" || disconnectKind === "meta";
  }, [disconnectKind]);

  const disableDisconnectBtn = useMemo(() => {
    if (disconnectLoading) return true;
    if (requireAuditAck && !disconnectAck) return true;
    return false;
  }, [disconnectLoading, requireAuditAck, disconnectAck]);

  return (
    <div className="flex min-h-screen bg-background">
      {/* ✅ Sidebar SOLO en desktop (md+) */}
      <div className="hidden md:block">
        <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      </div>

      {/* ✅ Content: sin margen en móvil, margen dinámico solo en md+ */}
      <div className={`flex-1 transition-all duration-300 ml-0 ${sidebarOpen ? "md:ml-64" : "md:ml-16"}`}>
        {/* ✅ padding responsive + espacio para bottom nav en móvil */}
        <div className="p-4 md:p-6 pb-24 md:pb-6">
          <div className="mb-8">
            <h1 className="text-3xl font-bold gradient-text">Configuración</h1>
            <p className="text-muted-foreground mt-2">
              Configura todas las opciones necesarias para que tu SAAS funcione correctamente
            </p>
            {hasChanges && (
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                <p className="text-sm text-yellow-800">
                  Tienes cambios sin guardar. No olvides guardar tu configuración.
                </p>
              </div>
            )}
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="notifications" className="flex items-center gap-2">
                <Bell className="w-4 h-4" />
                Notificaciones
              </TabsTrigger>
              <TabsTrigger value="security" className="flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Seguridad
              </TabsTrigger>
              <TabsTrigger value="integrations" className="flex items-center gap-2">
                <Globe className="w-4 h-4" />
                Integraciones
              </TabsTrigger>
            </TabsList>

            <TabsContent value="notifications" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="w-5 h-5" />
                    Configuración de Notificaciones
                  </CardTitle>
                  <CardDescription>Controla cómo y cuándo recibir notificaciones</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Mail className="w-4 h-4" />
                      <div>
                        <p className="font-medium">Notificaciones por Email</p>
                        <p className="text-sm text-muted-foreground">Recibe alertas importantes por correo</p>
                      </div>
                    </div>
                    <Switch
                      checked={settings.emailNotifications}
                      onCheckedChange={(checked) => updateSetting("emailNotifications", checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Smartphone className="w-4 h-4" />
                      <div>
                        <p className="font-medium">Notificaciones Push</p>
                        <p className="text-sm text-muted-foreground">Recibe notificaciones en tiempo real</p>
                      </div>
                    </div>
                    <Switch
                      checked={settings.pushNotifications}
                      onCheckedChange={(checked) => updateSetting("pushNotifications", checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Activity className="w-4 h-4" />
                      <div>
                        <p className="font-medium">Reportes Semanales</p>
                        <p className="text-sm text-muted-foreground">Resumen semanal de métricas</p>
                      </div>
                    </div>
                    <Switch
                      checked={settings.weeklyReports}
                      onCheckedChange={(checked) => updateSetting("weeklyReports", checked)}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="security" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Configuración de Seguridad
                  </CardTitle>
                  <CardDescription>Opciones para mantener tu cuenta segura</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">Autenticación de Dos Factores</p>
                      <p className="text-sm text-muted-foreground">Añade una capa extra de seguridad</p>
                    </div>
                    <Switch
                      checked={settings.twoFactorAuth}
                      onCheckedChange={(checked) => updateSetting("twoFactorAuth", checked)}
                    />
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium">Tiempo de Expiración de Sesión (horas)</p>
                    <Select value={settings.sessionTimeout} onValueChange={(value) => updateSetting("sessionTimeout", value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 hora</SelectItem>
                        <SelectItem value="8">8 horas</SelectItem>
                        <SelectItem value="24">24 horas</SelectItem>
                        <SelectItem value="168">1 semana</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="integrations" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="w-5 h-5" />
                    Integraciones de Aplicaciones
                  </CardTitle>
                  <CardDescription>Conecta tu cuenta con las plataformas principales</CardDescription>
                </CardHeader>

                {/* ✅ Estética móvil mejorada. PC se mantiene igual con md:* */}
                <CardContent className="space-y-4 md:space-y-6">
                  {/* Acciones superiores */}
                  <div className="flex flex-col md:flex-row gap-2 md:gap-2">
                    <Button
                      variant="outline"
                      onClick={refreshConnections}
                      disabled={loadingConnections}
                      className="w-full md:w-auto justify-center"
                    >
                      {loadingConnections ? "Actualizando..." : "Refrescar estado"}
                    </Button>

                    <Button
                      variant="secondary"
                      onClick={openPicker}
                      disabled={loadingConnections || pickerLoading || !mustPickAnything}
                      className="w-full md:w-auto justify-center flex items-center gap-2"
                      title={mustPickAnything ? "Seleccionar cuentas" : "No requiere selección"}
                    >
                      <Settings2 className="w-4 h-4" />
                      {pickerLoading ? "Cargando..." : mustPickAnything ? "Seleccionar cuentas" : "Selección OK"}
                    </Button>
                  </div>

                  {/* Shopify */}
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-4 border rounded-xl">
                    <div className="flex items-center gap-3">
                      <ShoppingBag className="w-6 h-6 text-green-600" />
                      <div>
                        <p className="font-medium">Shopify</p>
                        <p className="text-sm text-muted-foreground">Conecta tu tienda de Shopify</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:flex md:items-center gap-2 w-full md:w-auto">
                      <Button
                        variant={connections.shopify ? "default" : "outline"}
                        size="sm"
                        className={[
                          "w-full md:w-auto justify-center",
                          "col-span-2 md:col-auto",
                          connections.shopify ? "bg-green-700 hover:bg-green-800 text-white border-none" : "",
                        ].join(" ")}
                        disabled={true}
                        title="Shopify se conecta desde el Admin embebido (próximamente en Configuración)."
                      >
                        {loadingConnections ? "Cargando..." : connections.shopify ? "Conectado" : "Próximamente"}
                      </Button>

                      {connections.shopify ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => openDisconnect("shopify")}
                          disabled={loadingConnections}
                          className="w-full md:w-auto justify-center flex items-center gap-2 col-span-2 md:col-auto"
                          title="Desconectar Shopify"
                        >
                          <Unplug className="w-4 h-4" />
                          Desconectar
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {/* Google */}
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-4 border rounded-xl">
                    <div className="flex items-center gap-3">
                      <Search className="w-6 h-6 text-blue-600" />
                      <div>
                        <p className="font-medium">Google</p>
                        <p className="text-sm text-muted-foreground">Conecta con Google Analytics y Ads</p>
                        {status?.status?.googleAds?.requiredSelection || status?.status?.ga4?.requiredSelection ? (
                          <p className="text-xs text-amber-500 mt-1">Requiere selección para terminar la configuración.</p>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:flex md:items-center gap-2 w-full md:w-auto">
                      {!connections.google ? (
                        <Button
                          size="sm"
                          asChild
                          disabled={loadingConnections}
                          className="col-span-2 md:col-auto w-full md:w-auto justify-center"
                        >
                          <a href={connectGoogleUrl}>Conectar</a>
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          className="w-full md:w-auto justify-center bg-green-700 hover:bg-green-800 text-white border-none"
                          disabled={loadingConnections}
                        >
                          Conectado
                        </Button>
                      )}

                      {connections.google ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => openDisconnect("google")}
                          disabled={loadingConnections}
                          className="w-full md:w-auto justify-center flex items-center gap-2"
                          title="Desconectar Google (Ads + GA4)"
                        >
                          <Unplug className="w-4 h-4" />
                          Desconectar
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {/* Meta */}
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 p-4 border rounded-xl">
                    <div className="flex items-center gap-3">
                      <Facebook className="w-6 h-6 text-blue-700" />
                      <div>
                        <p className="font-medium">Meta</p>
                        <p className="text-sm text-muted-foreground">Conecta con Facebook e Instagram Ads</p>
                        {status?.status?.meta?.requiredSelection ? (
                          <p className="text-xs text-amber-500 mt-1">Requiere selección para terminar la configuración.</p>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:flex md:items-center gap-2 w-full md:w-auto">
                      {!connections.meta ? (
                        <Button
                          size="sm"
                          asChild
                          disabled={loadingConnections}
                          className="col-span-2 md:col-auto w-full md:w-auto justify-center"
                        >
                          <a href={connectMetaUrl}>Conectar</a>
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          className="w-full md:w-auto justify-center bg-green-700 hover:bg-green-800 text-white border-none"
                          disabled={loadingConnections}
                        >
                          Conectado
                        </Button>
                      )}

                      {connections.meta ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => openDisconnect("meta")}
                          disabled={loadingConnections}
                          className="w-full md:w-auto justify-center flex items-center gap-2"
                          title="Desconectar Meta"
                        >
                          <Unplug className="w-4 h-4" />
                          Desconectar
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="h-px w-full bg-border/50 my-2" />

                  {/* Suscripción */}
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 p-4 border rounded-xl">
                    <div className="flex items-start gap-3">
                      <CreditCard className="w-6 h-6 text-purple-500 mt-0.5" />
                      <div>
                        <p className="font-medium">Suscripción</p>
                        <p className="text-sm text-muted-foreground">
                          Plan actual: <span className="font-semibold">{currentPlan}</span> · Estado:{" "}
                          <span className="font-semibold">{subStatus}</span>
                        </p>
                        {portalError && (
                          <p className="text-sm text-red-500 mt-1 flex items-center gap-1">
                            <AlertCircle className="w-4 h-4" />
                            {portalError}
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      onClick={openBillingPortal}
                      disabled={portalLoading}
                      className="w-full md:w-auto bg-destructive hover:bg-destructive/90"
                    >
                      {portalLoading ? "Abriendo…" : "Gestionar / Cancelar plan"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <div className="flex justify-between items-center mt-8">
            <Button variant="outline" onClick={handleReset} className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4" />
              Restablecer
            </Button>

            <Button onClick={handleSave} disabled={isLoading || !hasChanges} className="flex items-center gap-2">
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isLoading ? "Guardando..." : "Guardar Configuración"}
            </Button>
          </div>
        </div>
      </div>

      {/* ✅ Mobile nav NUEVO (solo móvil) */}
      <div className="md:hidden">
        <MobileBottomNav />
      </div>

      {/* Dialog: Picker */}
      <Dialog open={pickerOpen} onOpenChange={(v) => !pickerLoading && setPickerOpen(v)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              Seleccionar cuentas para Integraciones
            </DialogTitle>
          </DialogHeader>

          <div className="text-sm text-muted-foreground">
            Límite: puedes seleccionar <b>{MAX_SELECT}</b> cuenta por tipo.
          </div>

          {pickerError ? <div className="text-sm text-red-500">{pickerError}</div> : null}

          <ScrollArea className="max-h-[55vh] pr-4">
            <div className="space-y-6">
              {requiredSelection.meta && metaOptions.length > 1 ? (
                <div className="space-y-2">
                  <div className="font-semibold">Meta Ads</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {metaOptions.map((o) => {
                      const checked = pickerSel.meta.has(o.idDigits);
                      const disabled = !checked && pickerSel.meta.size >= MAX_SELECT;
                      return (
                        <label key={o.idDigits} className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer">
                          <Checkbox
                            checked={checked}
                            disabled={disabled}
                            onCheckedChange={() => toggleOne("meta", o.idDigits)}
                          />
                          <div className="min-w-0">
                            <div className="truncate">{o.label}</div>
                            <div className="text-xs opacity-70">act_{o.idDigits}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {requiredSelection.googleAds && googleAdsOptions.length > 1 ? (
                <div className="space-y-2">
                  <div className="font-semibold">Google Ads</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {googleAdsOptions.map((o) => {
                      const checked = pickerSel.googleAds.has(o.idDigits);
                      const disabled = !checked && pickerSel.googleAds.size >= MAX_SELECT;
                      return (
                        <label key={o.idDigits} className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer">
                          <Checkbox
                            checked={checked}
                            disabled={disabled}
                            onCheckedChange={() => toggleOne("googleAds", o.idDigits)}
                          />
                          <div className="min-w-0">
                            <div className="truncate">{o.label}</div>
                            <div className="text-xs opacity-70">{o.idDigits}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {requiredSelection.ga4 && ga4Options.length > 1 ? (
                <div className="space-y-2">
                  <div className="font-semibold">Google Analytics (GA4)</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {ga4Options.map((o) => {
                      const checked = pickerSel.ga4.has(o.rawId);
                      const disabled = !checked && pickerSel.ga4.size >= MAX_SELECT;
                      return (
                        <label key={o.rawId} className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer">
                          <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => toggleOne("ga4", o.rawId)} />
                          <div className="min-w-0">
                            <div className="truncate">{o.label}</div>
                            <div className="text-xs opacity-70">{o.rawId}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {!mustPickAnything ? (
                <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                  No hay nada que seleccionar ahora (o solo hay 1 cuenta por tipo).
                </div>
              ) : null}
            </div>
          </ScrollArea>

          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={() => setPickerOpen(false)} disabled={pickerLoading}>
              Cancelar
            </Button>
            <Button onClick={savePicker} disabled={!canSavePicker || pickerLoading}>
              {pickerLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Guardando…
                </span>
              ) : (
                "Guardar selección"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Disconnect */}
      <Dialog
        open={disconnectOpen}
        onOpenChange={(v) => !disconnectLoading && !disconnectPreviewLoading && setDisconnectOpen(v)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Unplug className="w-4 h-4" />
              Desconectar {disconnectLabel}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-amber-400 mt-0.5" />
                <div className="text-sm">
                  <div className="font-medium">Acción delicada</div>
                  <div className="text-muted-foreground mt-1">
                    Al desconectar, se eliminarán los <b>tokens</b> y la <b>selección</b> guardada.
                    {requireAuditAck ? (
                      <>
                        {" "}
                        Además, por seguridad y consistencia, se eliminarán las <b>auditorías</b> asociadas a esta integración.
                      </>
                    ) : null}
                  </div>

                  {requireAuditAck ? (
                    <div className="text-muted-foreground mt-2">
                      {disconnectPreviewLoading ? (
                        <span className="inline-flex items-center gap-2 text-xs">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Calculando auditorías a eliminar…
                        </span>
                      ) : disconnectPreview && Number.isFinite(previewCount) && previewCount > 0 ? (
                        <>
                          <div className="text-xs">
                            Se eliminarán <b>{previewCount}</b> auditorías guardadas.
                          </div>
                          {previewBreakdown ? (
                            <div className="mt-1 text-xs opacity-90">
                              {Object.entries(previewBreakdown)
                                .filter(([, v]) => Number(v) > 0)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(" · ")}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="text-xs">
                          Se eliminarán las auditorías asociadas a esta integración. Esta acción no se puede deshacer.
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {requireAuditAck ? (
              <label className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer">
                <Checkbox checked={disconnectAck} onCheckedChange={(v) => setDisconnectAck(Boolean(v))} />
                <div className="text-sm">
                  <div className="font-medium">Entiendo y deseo continuar</div>
                  <div className="text-muted-foreground text-xs mt-1">
                    Confirmo que al desconectar {disconnectLabel} se eliminarán mis auditorías asociadas y tendré que volver a conectar para generar nuevas.
                  </div>
                </div>
              </label>
            ) : null}

            <div className="text-xs text-muted-foreground">
              Nota: esto no borra tu cuenta de Adray, solo desconecta la integración.
            </div>

            {disconnectError ? <div className="text-sm text-red-500">{disconnectError}</div> : null}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="secondary"
              onClick={() => setDisconnectOpen(false)}
              disabled={disconnectLoading || disconnectPreviewLoading}
            >
              Cancelar
            </Button>

            <Button
              variant="destructive"
              onClick={doDisconnect}
              disabled={disableDisconnectBtn || disconnectPreviewLoading}
              className="flex items-center gap-2"
              title={requireAuditAck && !disconnectAck ? "Confirma la casilla para continuar" : "Desconectar"}
            >
              {disconnectLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Desconectando…
                </span>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  Desconectar
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
