import { MessageCircle } from "lucide-react";

export function Footer() {
  return (
    <footer className="py-12 bg-card text-foreground border-t border-border">
      <div className="container mx-auto px-4 max-w-7xl">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 mb-8">
          <div>
            <h3 className="text-2xl font-bold mb-4">Adray</h3>
            <p className="text-muted-foreground">
              Optimización de marketing con IA para tu tienda Shopify
            </p>
          </div>
          
          <div>
            <h4 className="font-semibold mb-4">Enlaces</h4>
            <ul className="space-y-2 text-muted-foreground">
              <li>
                <a
                  href="https://adray.ai/terms-of-service.html"
                  className="hover:text-foreground transition-smooth"
                >
                  Términos
                </a>
              </li>
              <li>
                <a
                  href="https://adray.ai/politica.html"
                  className="hover:text-foreground transition-smooth"
                >
                  Privacidad
                </a>
              </li>
              <li>
                <a
                  href="https://adray.ai/support"
                  className="hover:text-foreground transition-smooth"
                >
                  Contacto
                </a>
              </li>
            </ul>
          </div>
          
          <div>
            <h4 className="font-semibold mb-4">Contacto</h4>
            <a 
              href="https://wa.me/1234567890" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-primary hover:text-primary/80 transition-smooth"
            >
              <MessageCircle className="w-5 h-5" />
              WhatsApp
            </a>
          </div>
        </div>
        
        <div className="border-t border-border pt-8 text-center text-muted-foreground text-sm">
          <p>© 2025 Adray · Todos los derechos reservados.</p>
        </div>
      </div>

      {/* WhatsApp Floating Button */}
      <a
        href="https://wa.me/1234567890"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-hero glow-primary rounded-full flex items-center justify-center shadow-elevated transition-smooth hover:scale-110 z-50"
        aria-label="WhatsApp"
      >
        <MessageCircle className="w-7 h-7 text-primary-foreground" />
      </a>
    </footer>
  );
}
