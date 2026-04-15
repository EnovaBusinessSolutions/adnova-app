import { Button } from "@/components/ui/button";
import { AlertCircle, Calendar } from "lucide-react";

export function Urgency() {
  return (
    <section className="py-16 bg-destructive/5 border-y border-destructive/30 animate-border-pulse">
      <div className="container mx-auto px-4 max-w-5xl">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-6 animate-fade-in">
          <div className="flex items-start gap-4">
            <AlertCircle className="w-6 h-6 md:w-8 md:h-8 text-destructive flex-shrink-0 mt-1 animate-pulse-alert" />
            <div>
              <p className="text-xl md:text-2xl font-bold text-foreground mb-2">
                Solo 50 auditorías gratuitas disponibles este mes
              </p>
              <p className="text-base md:text-lg text-muted-foreground">
                Agenda tu lugar antes del domingo.
              </p>
            </div>
          </div>
          
          <Button 
            size="lg" 
            className="text-base md:text-lg px-6 md:px-8 py-5 md:py-6 bg-gradient-hero glow-primary hover:scale-105 transition-smooth whitespace-nowrap w-full sm:w-auto"
            onClick={() => window.location.href = '#agendar'}
          >
            <Calendar className="w-5 h-5 mr-2" />
            Agendar ahora
          </Button>
        </div>
      </div>
    </section>
  );
}
