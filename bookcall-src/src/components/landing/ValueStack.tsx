import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Brain, User, FileText, Globe } from "lucide-react";

const benefits = [
  {
    icon: Brain,
    title: "Auditoría con IA",
    description: "Reporte personalizado con tus datos de Meta y Google."
  },
  {
    icon: User,
    title: "Revisión con un experto",
    description: "Llamada de 15 minutos para explicarte los resultados."
  },
  {
    icon: FileText,
    title: "Plan de Acción 3 Pasos",
    description: "PDF con acciones específicas para mejorar tu ROAS."
  },
  {
    icon: Globe,
    title: "Análisis web (si no conectas)",
    description: "Revisamos tu tienda y mostramos su potencial."
  }
];

export function ValueStack() {
  return (
    <section className="py-20 bg-background">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl lg:text-section-title text-foreground mb-4">
            ¿Qué Incluye tu Auditoría?
          </h2>
          <p className="text-base md:text-lg lg:text-hero-lede text-muted-foreground px-4">
            Todo lo que necesitas para entender y mejorar tu inversión publicitaria
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-12 max-w-4xl mx-auto">
          {benefits.map((benefit, index) => (
            <Card key={index} className="bg-gradient-card border-border hover:border-primary transition-smooth hover:glow-primary">
              <CardContent className="p-6 space-y-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <benefit.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground">
                  {benefit.title}
                </h3>
                <p className="text-muted-foreground">
                  {benefit.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="text-center space-y-6 px-4">
          <div>
            <p className="text-xl md:text-2xl lg:text-3xl font-bold text-foreground mb-2">
              Valor total: <span className="line-through text-muted-foreground">$10,300 MXN</span>
            </p>
            <p className="text-3xl md:text-4xl font-bold text-primary">
              Hoy: Gratis
            </p>
          </div>
          
          <Button 
            size="lg" 
            className="text-base md:text-lg px-6 md:px-8 py-5 md:py-6 bg-gradient-hero glow-primary hover:scale-105 transition-smooth w-full sm:w-auto"
            onClick={() => window.location.href = '#agendar'}
          >
            Solicitar mi auditoría gratuita
          </Button>
        </div>
      </div>
    </section>
  );
}
