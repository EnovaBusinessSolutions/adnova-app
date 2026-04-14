import { Card, CardContent } from "@/components/ui/card";
import { Star } from "lucide-react";

const testimonials = [
  {
    name: "María González",
    store: "Boutique Luna",
    text: "En 15 minutos descubrí que estaba perdiendo $2,000 pesos al mes en anuncios mal configurados. Ahora mi ROAS es de 3.5x.",
    rating: 5
  },
  {
    name: "Carlos Ramírez",
    store: "Tech Store MX",
    text: "La auditoría me mostró exactamente qué estaba funcionando y qué no. Implementé los 3 pasos y mis ventas subieron 40%.",
    rating: 5
  },
  {
    name: "Ana Martínez",
    store: "Naturalia",
    text: "Pensé que necesitaba una agencia cara, pero Adnova AI me dio mejores consejos en una sola llamada.",
    rating: 5
  }
];

export function Testimonials() {
  return (
    <section className="py-20 bg-card/30">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl lg:text-section-title text-foreground mb-4 px-4">
            Más de 100 tiendas en línea ya usan Adnova AI
          </h2>
          <p className="text-base md:text-lg lg:text-hero-lede text-muted-foreground px-4">
            para entender y mejorar sus anuncios
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
          {testimonials.map((testimonial, index) => (
            <Card key={index} className="bg-gradient-card border-border hover:border-primary/50 hover:glow-primary transition-smooth">
              <CardContent className="p-6 space-y-4">
                <div className="flex gap-1">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 fill-primary text-primary" />
                  ))}
                </div>
                
                <p className="text-foreground italic">
                  "{testimonial.text}"
                </p>
                
                <div className="pt-4 border-t border-border">
                  <p className="font-semibold text-foreground">{testimonial.name}</p>
                  <p className="text-sm text-muted-foreground">{testimonial.store}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
