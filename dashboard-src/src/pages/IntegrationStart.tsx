import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

type Kind = "meta" | "google_ads" | "ga4";

function onceKey(key: string) {
  try {
    const k = `adray:int-start:${key}`;
    if (sessionStorage.getItem(k)) return false;
    sessionStorage.setItem(k, "1");
    return true;
  } catch {
    // Si sessionStorage falla (modo privado estricto), preferimos NO bloquear el evento
    return true;
  }
}

function digitsOnly(s: string) {
  return String(s || "").replace(/[^\d]/g, "");
}

export default function IntegrationStart({ kind }: { kind: Kind }) {
  const navigate = useNavigate();
  const location = useLocation();

  const data = useMemo(() => {
    const sp = new URLSearchParams(location.search);

    // Meta: account_id
    // Google Ads: a veces viene como customer_id (toleramos account_id también)
    const accountId = sp.get("account_id") || sp.get("customer_id") || "";

    // GA4: property puede venir como "properties/123" o "123"
    const rawProp = sp.get("property") || sp.get("propertyId") || "";
    const property = digitsOnly(rawProp.replace(/^properties\//, "").trim());

    return { accountId, property };
  }, [location.search]);

  useEffect(() => {
    // ✅ IMPORTANTE:
    // Dentro del SPA NUNCA agregamos "/dashboard".
    // El BrowserRouter basename ya lo aplica en PROD.
    let finalUrl = "/settings?tab=integrations";

    if (kind === "meta") {
      finalUrl = data.accountId
        ? `/meta-ads?account_id=${encodeURIComponent(data.accountId)}`
        : "/meta-ads";
    }

    if (kind === "google_ads") {
      finalUrl = data.accountId
        ? `/google-ads?account_id=${encodeURIComponent(data.accountId)}`
        : "/google-ads";
    }

    if (kind === "ga4") {
      finalUrl = data.property
        ? `/google-analytics?property=${encodeURIComponent(data.property)}`
        : "/google-analytics";
    }

    const key =
      kind === "ga4"
        ? `${kind}:${data.property || "unknown"}`
        : `${kind}:${data.accountId || "unknown"}`;

    // ✅ Evento SOLO 1 vez por sesión
    if (onceKey(key)) {
      // GA4 (gtag)
      try {
        // @ts-ignore
        window.gtag?.("event", "integration_connected", {
          integration: kind,
          account_id: data.accountId || undefined,
          property: data.property || undefined,
          source: "integration_start",
        });
      } catch {}

      // Meta Pixel (fbq)
      try {
        // @ts-ignore
        window.fbq?.("trackCustom", "IntegrationConnected", {
          integration: kind,
          account_id: data.accountId || undefined,
          property: data.property || undefined,
          source: "integration_start",
        });
      } catch {}
    }

    // ✅ replace para que /start NO se quede como URL “normal”
    navigate(finalUrl, { replace: true });
  }, [kind, data.accountId, data.property, navigate]);

  return null;
}
