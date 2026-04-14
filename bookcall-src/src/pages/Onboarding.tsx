
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ShoppingBag, Mail, Facebook } from "lucide-react";
import { ConnectionCard } from "@/components/onboarding/ConnectionCard";
import { ProgressStepper } from "@/components/onboarding/ProgressStepper";
import { OnboardingProgress } from "@/components/onboarding/OnboardingProgress";
import { toast } from "@/components/ui/sonner";

const ONBOARDING_STEPS = [
  {
    title: "Conecta tus cuentas",
    description: "Shopify y tus plataformas de marketing",
  },
  {
    title: "Permisos",
    description: "Confirma acceso a datos",
  },
  {
    title: "Análisis",
    description: "Buscaremos oportunidades de mejora",
  },
  {
    title: "Panel de Control",
    description: "Revisa tus recomendaciones",
  },
];

export default function Onboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [metaConnected, setMetaConnected] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const navigate = useNavigate();

  const canProceed = shopifyConnected;

  const handleNextStep = () => {
    if (currentStep === 0 && !shopifyConnected) {
      toast.error("La conexión con Shopify es necesaria para continuar.");
      return;
    }

    if (currentStep === 1) {
      setIsAnalyzing(true);
    }
    setCurrentStep((prev) => prev + 1);
  };

  const handleAnalysisComplete = () => {
    setTimeout(() => {
      navigate("/dashboard");
    }, 1000);
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden md:flex w-1/3 bg-background border-r border-border p-8">
        <div className="w-full max-w-xs mx-auto">
          <div className="mb-8">
            <h1 className="text-2xl font-bold">
              <span className="text-primary">ADNOVA</span> <span>AI 🤖</span>
            </h1>
            <p className="text-muted-foreground mt-2">
              Configurando la optimización de tu tienda
            </p>
          </div>

          <ProgressStepper steps={ONBOARDING_STEPS} currentStep={currentStep} />
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        {currentStep === 0 && (
          <div className="w-full max-w-md space-y-6">
            <div>
              <h2 className="text-2xl font-semibold">Conecta tus cuentas</h2>
              <p className="text-muted-foreground mt-2">
                Conecta tu tienda y plataformas de marketing para que podamos analizarlas y 
                optimizarlas. <span className="text-primary font-medium">La conexión con Shopify es obligatoria.</span>
              </p>
            </div>

            <div className="space-y-4">
              <ConnectionCard
                title="Tienda Shopify"
                description="Conecta tu tienda Shopify para habilitar la optimización (Obligatorio)"
                icon={<ShoppingBag size={24} />}
                connected={shopifyConnected}
                onConnect={() => setShopifyConnected(true)}
                onDisconnect={() => setShopifyConnected(false)}
                required={true}
              />

              <ConnectionCard
                title="Google Analytics y Ads"
                description="Conecta tu cuenta de Google para datos de tráfico y anuncios (Opcional)"
                icon={<Mail size={24} />}
                connected={googleConnected}
                onConnect={() => setGoogleConnected(true)}
                onDisconnect={() => setGoogleConnected(false)}
              />

              <ConnectionCard
                title="Meta Business Manager"
                description="Conecta Facebook e Instagram para datos de píxel y anuncios (Opcional)"
                icon={<Facebook size={24} />}
                connected={metaConnected}
                onConnect={() => setMetaConnected(true)}
                onDisconnect={() => setMetaConnected(false)}
              />
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleNextStep}
                disabled={!canProceed}
                variant="gradient"
              >
                Continuar
              </Button>
            </div>
          </div>
        )}

        {currentStep === 1 && (
          <div className="w-full max-w-md space-y-6">
            <div>
              <h2 className="text-2xl font-semibold">Revisar permisos</h2>
              <p className="text-muted-foreground mt-2">
                Confirma el acceso a datos requerido para el análisis
              </p>
            </div>

            <div className="space-y-4 border border-border rounded-lg p-4">
              <div>
                <h3 className="font-medium">Datos de Shopify</h3>
                <ul className="list-disc list-inside text-sm text-muted-foreground mt-1 space-y-1">
                  <li>Configuración de la tienda y tema</li>
                  <li>Información de productos y precios</li>
                  <li>Historial de pedidos (anonimizado)</li>
                  <li>Flujo de pago y configuraciones</li>
                </ul>
              </div>

              {googleConnected && (
                <div>
                  <h3 className="font-medium">Google Analytics</h3>
                  <ul className="list-disc list-inside text-sm text-muted-foreground mt-1 space-y-1">
                    <li>Métricas de tráfico y engagement</li>
                    <li>Datos de conversión y eventos</li>
                    <li>Rendimiento de campaña</li>
                  </ul>
                </div>
              )}

              {metaConnected && (
                <div>
                  <h3 className="font-medium">Meta Business Manager</h3>
                  <ul className="list-disc list-inside text-sm text-muted-foreground mt-1 space-y-1">
                    <li>Configuración de píxel y eventos</li>
                    <li>Rendimiento de campañas publicitarias</li>
                    <li>Información de audiencia</li>
                  </ul>
                </div>
              )}

              <p className="text-xs text-muted-foreground mt-2">
                ADNOVA no almacena información personal de los clientes y cumple con todas las
                leyes de privacidad aplicables. Puedes revisar nuestra política de privacidad completa
                <a href="#" className="text-primary hover:underline"> aquí</a>.
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setCurrentStep(0)}>
                Atrás
              </Button>
              <Button onClick={handleNextStep} variant="gradient">
                Confirmar y Continuar
              </Button>
            </div>
          </div>
        )}

        {currentStep === 2 && isAnalyzing && (
          <OnboardingProgress isAnalyzing={isAnalyzing} onComplete={handleAnalysisComplete} />
        )}
      </div>
    </div>
  );
}
