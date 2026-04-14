
import { PixelTable } from "@/components/pixel/PixelTable";
import { Button } from "@/components/ui/button";
import { CircleCheck } from "lucide-react";

export default function PixelVerifier() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Verificador de Píxeles</h1>
        <p className="text-muted-foreground">
          Verifica que tus píxeles de seguimiento funcionan correctamente en todas las plataformas
        </p>
      </div>
      
      <PixelTable />
      
      <div className="dashboard-section">
        <h2 className="section-title">Calidad de Implementación de Eventos</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Análisis de tu implementación de seguimiento comparado con las mejores prácticas
        </p>
        
        <div className="space-y-4">
          <div className="border border-border rounded-md p-4">
            <div className="flex items-start gap-3">
              <div className="severity-indicator severity-high mt-1.5" />
              <div>
                <h3 className="font-medium">Parámetros de Valor Faltantes</h3>
                <p className="text-sm text-muted-foreground">
                  A tus eventos de Compra de Facebook les faltan parámetros de valor, lo que resulta en 
                  cálculos inexactos de ROAS en tus informes de anuncios.
                </p>
                <div className="mt-2">
                  <Button size="sm" variant="gradient">
                    Corregir Implementación
                  </Button>
                </div>
              </div>
            </div>
          </div>
          
          <div className="border border-border rounded-md p-4">
            <div className="flex items-start gap-3">
              <div className="severity-indicator severity-medium mt-1.5" />
              <div>
                <h3 className="font-medium">Eventos Duplicados</h3>
                <p className="text-sm text-muted-foreground">
                  Los eventos de Google Analytics se están disparando dos veces en algunas páginas, lo que 
                  potencialmente afecta la precisión de tus informes de conversión.
                </p>
                <div className="mt-2">
                  <Button size="sm" variant="gradient">
                    Corregir Implementación
                  </Button>
                </div>
              </div>
            </div>
          </div>
          
          <div className="border border-border rounded-md p-4">
            <div className="flex items-start gap-3">
              <div className="severity-indicator severity-low mt-1.5" />
              <div>
                <h3 className="font-medium">Ecommerce Mejorado No Completamente Utilizado</h3>
                <p className="text-sm text-muted-foreground">
                  No estás aprovechando al máximo el seguimiento de Ecommerce Mejorado en Google Analytics,
                  perdiendo información valiosa sobre el comportamiento de compra.
                </p>
                <div className="mt-2">
                  <Button size="sm" variant="gradient">
                    Mejorar Implementación
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
