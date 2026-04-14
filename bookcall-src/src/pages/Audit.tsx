
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuditItem } from "@/components/audit/AuditItem";

export default function Audit() {
  const [activeTab, setActiveTab] = useState("ux");

  const auditItems = {
    ux: [
      {
        id: "ux1",
        title: "Menú Móvil Difícil de Acceder",
        description: "Tu menú de navegación móvil requiere que los usuarios hagan 2 toques para acceder a las secciones clave de la tienda. Esto crea fricción innecesaria para los usuarios móviles, que representan el 64% de tu tráfico.",
        severity: "high",
        screenshot: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158",
        solution: "Rediseñar el encabezado móvil para hacer que los elementos principales de navegación sean directamente visibles o accesibles con un solo toque."
      },
      {
        id: "ux2",
        title: "Imágenes de Producto Sin Zoom",
        description: "Las páginas de detalle de producto no permiten a los clientes hacer zoom en las imágenes, lo que dificulta ver los detalles antes de la compra.",
        severity: "medium",
        screenshot: "https://images.unsplash.com/photo-1605810230434-7631ac76ec81",
        solution: "Implementar una función de zoom en las imágenes de productos que funcione tanto en escritorio como en dispositivos móviles."
      },
      {
        id: "ux3",
        title: "El Carrito se Cierra Automáticamente",
        description: "El panel del carrito se cierra automáticamente después de 5 segundos, interrumpiendo el proceso de pago para algunos usuarios.",
        severity: "medium",
        solution: "Eliminar el comportamiento de cierre automático y cerrar el panel del carrito solo cuando el usuario lo cierre explícitamente."
      },
    ],
    seo: [
      {
        id: "seo1",
        title: "Meta Descripciones Faltantes",
        description: "8 páginas de productos carecen de meta descripciones, lo que perjudica su visibilidad potencial en los resultados de búsqueda.",
        severity: "medium",
        screenshot: "https://images.unsplash.com/photo-1487058792275-0ad4aaf24ca7",
        solution: "Generar meta descripciones únicas y ricas en palabras clave para cada página de producto."
      },
      {
        id: "seo2",
        title: "Enlaces Internos Rotos",
        description: "Se encontraron 3 enlaces internos rotos en tus publicaciones de blog que conducen a errores 404.",
        severity: "medium",
        solution: "Actualizar o eliminar estos enlaces rotos para mejorar la experiencia del usuario y el SEO."
      },
    ],
    performance: [
      {
        id: "perf1",
        title: "Imágenes Grandes No Optimizadas",
        description: "12 imágenes de productos superan los 500KB de tamaño, lo que ralentiza significativamente los tiempos de carga de las páginas.",
        severity: "high",
        screenshot: "https://images.unsplash.com/photo-1498050108023-c5249f4df085",
        solution: "Comprimir y redimensionar estas imágenes a menos de 200KB sin perder calidad visual."
      },
      {
        id: "perf2",
        title: "JavaScript que Bloquea el Renderizado",
        description: "Varios archivos JavaScript están bloqueando el renderizado de tus páginas, aumentando el tiempo de carga en 2.3 segundos.",
        severity: "high",
        solution: "Diferir JavaScript no crítico y optimizar la secuencia de carga."
      },
      {
        id: "perf3",
        title: "Sin Caché del Navegador",
        description: "Tu tienda no está utilizando el almacenamiento en caché del navegador para activos estáticos.",
        severity: "low",
        solution: "Configurar el almacenamiento en caché del navegador para mejorar la velocidad de la página para los visitantes recurrentes."
      },
    ],
    media: [
      {
        id: "media1",
        title: "Faltan Videos de Productos",
        description: "Ninguno de tus 5 productos más vendidos tiene videos de producto, lo que podría mejorar las tasas de conversión.",
        severity: "low",
        solution: "Agregar videos de demostración de productos al menos a tus productos más vendidos."
      },
      {
        id: "media2",
        title: "Proporciones de Imagen Inconsistentes",
        description: "Las imágenes de los productos tienen proporciones de aspecto inconsistentes, creando una vista de cuadrícula desalineada.",
        severity: "medium",
        screenshot: "https://images.unsplash.com/photo-1531297484001-80022131f5a1",
        solution: "Estandarizar todas las dimensiones de las imágenes de los productos para mantener la consistencia visual."
      },
    ]
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Informe de Auditoría del Sitio</h1>
        <p className="text-muted-foreground">
          Análisis completo de tu tienda con recomendaciones accionables
        </p>
      </div>
      
      <Tabs defaultValue="ux" className="w-full" onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-4 mb-6">
          <TabsTrigger value="ux">Problemas UX</TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
          <TabsTrigger value="performance">Rendimiento</TabsTrigger>
          <TabsTrigger value="media">Medios</TabsTrigger>
        </TabsList>
        
        {(["ux", "seo", "performance", "media"] as const).map((tab) => (
          <TabsContent key={tab} value={tab} className="space-y-4">
            {auditItems[tab].map((item) => (
              <AuditItem
                key={item.id}
                title={item.title}
                description={item.description}
                severity={item.severity as "high" | "medium" | "low"}
                screenshot={item.screenshot}
                solution={item.solution}
              />
            ))}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
