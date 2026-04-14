
import { useState } from "react";
import { ActionItem } from "./ActionItem";
import { useToast } from "@/hooks/use-toast";

const INITIAL_ACTIONS = [
  {
    id: "1",
    title: "Evento de Compra Faltante",
    description: "El píxel de Facebook no está rastreando eventos de compra al finalizar el pago",
    severity: "high" as const,
    actionText: "Arreglo automático",
  },
  {
    id: "2",
    title: "Imágenes de Producto Lentas",
    description: "12 imágenes de productos exceden el tamaño de archivo recomendado",
    severity: "medium" as const,
    actionText: "Optimizar",
  },
  {
    id: "3",
    title: "Metadescripción Faltante",
    description: "8 páginas de productos no tienen metadescripciones",
    severity: "medium" as const,
    actionText: "Generar",
  },
  {
    id: "4", 
    title: "Recuperación de Carrito Abandonado",
    description: "Habilitar correos automáticos para carritos abandonados",
    severity: "low" as const,
    actionText: "Habilitar",
  },
];

export function ActionCenter() {
  const [actions, setActions] = useState(INITIAL_ACTIONS);
  const { toast } = useToast();
  
  const handleAction = (id: string) => {
    const action = actions.find(a => a.id === id);
    if (!action) return;
    
    toast({
      title: "Acción en progreso",
      description: `Trabajando en: ${action.title}`,
    });
    
    // Simulación de completado de acción
    setTimeout(() => {
      setActions(actions.filter(a => a.id !== id));
      toast({
        title: "Acción completada",
        description: `Resuelto correctamente: ${action.title}`,
      });
    }, 2000);
  };
  
  return (
    <div className="dashboard-section">
      <h2 className="section-title">Centro de Acciones</h2>
      <div className="rounded-md border border-border">
        {actions.length > 0 ? (
          actions.map((action) => (
            <ActionItem
              key={action.id}
              title={action.title}
              description={action.description}
              severity={action.severity}
              actionText={action.actionText}
              onAction={() => handleAction(action.id)}
            />
          ))
        ) : (
          <div className="p-8 text-center">
            <p className="text-muted-foreground text-sm">
              ¡Todas las acciones recomendadas han sido completadas! 🎉
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
