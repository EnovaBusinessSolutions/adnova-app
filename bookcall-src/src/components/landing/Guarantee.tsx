import { Button } from "@/components/ui/button";
import { Shield } from "lucide-react";

export function Guarantee() {
  return (
    <section className="py-20 bg-card/50 border-y border-border">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="text-center space-y-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/20 border border-primary/30 glow-primary">
            <Shield className="w-8 h-8 text-primary animate-shield-glow" />
          </div>
          
          <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground px-4">
            Tu tiempo vale. Si no obtienes al menos 3 insights accionables durante la auditoría, te haremos una segunda sesión gratuita personalizada.
          </h2>
          
          <p className="text-base md:text-lg lg:text-hero-lede text-muted-foreground px-4">
            Sin tarjeta. Sin compromisos. Solo resultados.
          </p>
          
          <Button 
            size="lg" 
            className="text-base md:text-lg px-6 md:px-8 py-5 md:py-6 bg-gradient-hero glow-primary hover:scale-105 transition-smooth w-full sm:w-auto"
            onClick={() => window.location.href = '#agendar'}
          >
            Probar Adray sin riesgo
          </Button>
        </div>
      </div>
    </section>
  );
}
