
import { Button } from "@/components/ui/button";
import { CalendarClock } from "lucide-react";

export default function ComingSoon() {
  return (
    <div className="flex flex-col items-center justify-center h-[80vh] text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-6">
        <CalendarClock className="h-8 w-8 text-muted-foreground" />
      </div>
      
      <h1 className="text-3xl font-bold mb-2">Próximamente</h1>
      <p className="text-xl text-muted-foreground mb-6 max-w-md">
        Estamos trabajando en nuevas funciones emocionantes para la optimización de tu tienda
      </p>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mb-8">
        <div className="border border-border rounded-lg p-6 text-left">
          <h2 className="text-lg font-medium mb-2">Panel de ROAS</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Seguimiento completo del Retorno de Inversión en Publicidad a través de todos tus canales de marketing en un solo lugar.
          </p>
          <Button variant="outline" disabled>Llega en junio</Button>
        </div>
        
        <div className="border border-border rounded-lg p-6 text-left">
          <h2 className="text-lg font-medium mb-2">Generador de creatividades con IA</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Genera anuncios y textos de alta conversión basados en tus mejores activos.
          </p>
          <Button variant="outline" disabled>Llega en julio</Button>
        </div>
        
        <div className="border border-border rounded-lg p-6 text-left">
          <h2 className="text-lg font-medium mb-2">Planificador de campañas</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Planifica y programa tus campañas de marketing en múltiples plataformas con asignación inteligente de presupuesto.
          </p>
          <Button variant="outline" disabled>Llega en agosto</Button>
        </div>
        
        <div className="border border-border rounded-lg p-6 text-left">
          <h2 className="text-lg font-medium mb-2">Análisis del recorrido del cliente</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Visualización avanzada del recorrido de tu cliente con identificación de puntos de fricción.
          </p>
          <Button variant="outline" disabled>Llega en septiembre</Button>
        </div>
      </div>
      
      <Button variant="gradient">
        Solicitar una función
      </Button>
    </div>
  );
}
