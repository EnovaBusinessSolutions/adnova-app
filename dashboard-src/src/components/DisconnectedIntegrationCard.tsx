import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Facebook, Search, BarChart3, Settings2 } from "lucide-react";
import { useMemo } from "react";

type Platform = "meta" | "googleAds" | "ga4";

type Props = {
  platform: Platform;
  title?: string;
  description?: string;
  to?: string; // default: settings integrations
};

export default function DisconnectedIntegrationCard({
  platform,
  title,
  description,
  to,
}: Props) {
  const cfg = useMemo(() => {
    if (platform === "meta") {
      return {
        icon: Facebook,
        defaultTitle: "Meta Ads no está conectado",
        defaultDesc:
          "Para ver métricas y tendencias reales de Meta Ads, conecta la integración en Configuración → Integraciones.",
      };
    }
    if (platform === "googleAds") {
      return {
        icon: Search,
        defaultTitle: "Google Ads no está conectado",
        defaultDesc:
          "Para ver métricas y tendencias reales de Google Ads, conecta la integración en Configuración → Integraciones.",
      };
    }
    return {
      icon: BarChart3,
      defaultTitle: "Google Analytics (GA4) no está conectado",
      defaultDesc:
        "Para ver métricas y tendencias reales de GA4, conecta la integración en Configuración → Integraciones.",
    };
  }, [platform]);

  const Icon = cfg.icon;
  const href = to || `/dashboard/settings?tab=integrations`;

  return (
    <Card className="border-border/60 bg-card/40">
      <CardContent className="p-10">
        <div className="flex flex-col items-center justify-center text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-purple-500/15 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-purple-300" />
          </div>

          <div className="flex items-center gap-2 text-lg font-semibold">
            <Icon className="w-5 h-5 text-purple-300" />
            <span>{title || cfg.defaultTitle}</span>
          </div>

          <p className="text-sm text-muted-foreground max-w-xl">
            {description || cfg.defaultDesc}
          </p>

          <Button asChild className="mt-2 bg-purple-600 hover:bg-purple-700">
            <a href={href} className="inline-flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              Ir a configuración
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
