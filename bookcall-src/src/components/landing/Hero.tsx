import { Button } from "@/components/ui/button";
import { Calendar, Shield, TrendingUp } from "lucide-react";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-animated-gradient pt-20 pb-24">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Glowing orbs */}
        <div className="absolute top-20 left-10 w-64 h-64 bg-primary/10 rounded-full blur-3xl animate-pulse-glow"></div>
        <div className="absolute bottom-20 right-10 w-80 h-80 bg-purple-900/10 rounded-full blur-3xl animate-pulse-glow" style={{ animationDelay: '2s' }}></div>
        <div className="absolute top-1/2 left-1/3 w-72 h-72 bg-violet-950/8 rounded-full blur-3xl animate-pulse-glow" style={{ animationDelay: '4s' }}></div>
        
        {/* Grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(139,92,246,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(139,92,246,0.015)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_50%,black,transparent)]"></div>
        
        {/* AI Neural Network */}
        <svg className="absolute inset-0 w-full h-full opacity-30" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="lineGradient1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0" />
              <stop offset="50%" stopColor="hsl(var(--primary))" stopOpacity="0.4" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="lineGradient2" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="hsl(var(--secondary))" stopOpacity="0" />
              <stop offset="50%" stopColor="hsl(var(--secondary))" stopOpacity="0.35" />
              <stop offset="100%" stopColor="hsl(var(--secondary))" stopOpacity="0" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          
          {/* Connection lines with enhanced effects */}
          <g filter="url(#glow)">
            <line x1="15%" y1="25%" x2="35%" y2="35%" stroke="url(#lineGradient1)" strokeWidth="1.5" strokeDasharray="800" style={{ animation: 'ai-line-draw 6s linear infinite, ai-line-glow 3s ease-in-out infinite' }} />
            <line x1="35%" y1="35%" x2="55%" y2="25%" stroke="url(#lineGradient1)" strokeWidth="1.5" strokeDasharray="800" style={{ animation: 'ai-line-draw 6s linear infinite 1s, ai-line-glow 3s ease-in-out infinite 0.5s' }} />
            <line x1="55%" y1="25%" x2="75%" y2="40%" stroke="url(#lineGradient2)" strokeWidth="1.5" strokeDasharray="800" style={{ animation: 'ai-line-draw 6s linear infinite 2s, ai-line-glow 3s ease-in-out infinite 1s' }} />
            <line x1="25%" y1="60%" x2="45%" y2="50%" stroke="url(#lineGradient1)" strokeWidth="1.5" strokeDasharray="800" style={{ animation: 'ai-line-draw 6s linear infinite 3s, ai-line-glow 3s ease-in-out infinite 1.5s' }} />
            <line x1="45%" y1="50%" x2="65%" y2="65%" stroke="url(#lineGradient2)" strokeWidth="1.5" strokeDasharray="800" style={{ animation: 'ai-line-draw 6s linear infinite 4s, ai-line-glow 3s ease-in-out infinite 2s' }} />
            <line x1="35%" y1="35%" x2="45%" y2="50%" stroke="url(#lineGradient1)" strokeWidth="1" strokeDasharray="800" style={{ animation: 'ai-line-draw 6s linear infinite 2.5s, ai-line-glow 3s ease-in-out infinite 1.2s' }} />
            <line x1="55%" y1="25%" x2="65%" y2="65%" stroke="url(#lineGradient2)" strokeWidth="1" strokeDasharray="800" style={{ animation: 'ai-line-draw 6s linear infinite 3.5s, ai-line-glow 3s ease-in-out infinite 1.8s' }} />
            <line x1="15%" y1="25%" x2="25%" y2="60%" stroke="url(#lineGradient1)" strokeWidth="1" strokeDasharray="800" style={{ animation: 'ai-line-draw 6s linear infinite 1.5s, ai-line-glow 3s ease-in-out infinite 0.8s' }} />
            <line x1="75%" y1="40%" x2="65%" y2="65%" stroke="url(#lineGradient2)" strokeWidth="1" strokeDasharray="800" style={{ animation: 'ai-line-draw 6s linear infinite 4.5s, ai-line-glow 3s ease-in-out infinite 2.2s' }} />
          </g>
        </svg>
        
        {/* AI Nodes - More subtle */}
        <div className="absolute top-[25%] left-[15%] w-3 h-3 rounded-full bg-gradient-to-br from-primary via-primary to-primary/60 animate-ai-node border border-primary/30" style={{ animationDelay: '0s' }}>
          <div className="absolute inset-0 rounded-full bg-primary/20 blur-sm"></div>
        </div>
        <div className="absolute top-[35%] left-[35%] w-4 h-4 rounded-full bg-gradient-to-br from-primary via-secondary to-primary animate-ai-node border border-primary/40" style={{ animationDelay: '0.3s' }}>
          <div className="absolute inset-0 rounded-full bg-primary/25 blur-md"></div>
        </div>
        <div className="absolute top-[25%] left-[55%] w-3 h-3 rounded-full bg-gradient-to-br from-secondary via-primary to-secondary/60 animate-ai-node-secondary border border-secondary/30" style={{ animationDelay: '0.6s' }}>
          <div className="absolute inset-0 rounded-full bg-secondary/20 blur-sm"></div>
        </div>
        <div className="absolute top-[40%] left-[75%] w-3 h-3 rounded-full bg-gradient-to-br from-primary via-primary to-primary/60 animate-ai-node border border-primary/30" style={{ animationDelay: '0.9s' }}>
          <div className="absolute inset-0 rounded-full bg-primary/20 blur-sm"></div>
        </div>
        <div className="absolute top-[60%] left-[25%] w-2 h-2 rounded-full bg-gradient-to-br from-secondary via-secondary to-primary animate-ai-node-secondary border border-secondary/30" style={{ animationDelay: '1.2s' }}>
          <div className="absolute inset-0 rounded-full bg-secondary/20 blur-sm"></div>
        </div>
        <div className="absolute top-[50%] left-[45%] w-4 h-4 rounded-full bg-gradient-to-br from-primary via-secondary to-primary animate-ai-node border border-primary/40" style={{ animationDelay: '1.5s' }}>
          <div className="absolute inset-0 rounded-full bg-primary/25 blur-md"></div>
        </div>
        <div className="absolute top-[65%] left-[65%] w-3 h-3 rounded-full bg-gradient-to-br from-secondary via-primary to-secondary animate-ai-node-secondary border border-secondary/30" style={{ animationDelay: '1.8s' }}>
          <div className="absolute inset-0 rounded-full bg-secondary/20 blur-sm"></div>
        </div>
        
        {/* Data Particles */}
        <div className="absolute bottom-0 left-[10%] w-1.5 h-1.5 rounded-full bg-violet-400/60 animate-data-particle" style={{ animationDelay: '0s' }}>
          <div className="absolute inset-0 rounded-full bg-violet-400/40 blur-sm"></div>
        </div>
        <div className="absolute bottom-0 left-[30%] w-1 h-1 rounded-full bg-primary/60 animate-data-particle" style={{ animationDelay: '2s' }}>
          <div className="absolute inset-0 rounded-full bg-primary/40 blur-sm"></div>
        </div>
        <div className="absolute bottom-0 left-[50%] w-1.5 h-1.5 rounded-full bg-purple-400/60 animate-data-particle" style={{ animationDelay: '4s' }}>
          <div className="absolute inset-0 rounded-full bg-purple-400/40 blur-sm"></div>
        </div>
        <div className="absolute bottom-0 left-[70%] w-1 h-1 rounded-full bg-violet-500/60 animate-data-particle" style={{ animationDelay: '6s' }}>
          <div className="absolute inset-0 rounded-full bg-violet-500/40 blur-sm"></div>
        </div>
        <div className="absolute bottom-0 left-[85%] w-1.5 h-1.5 rounded-full bg-primary/60 animate-data-particle" style={{ animationDelay: '1s' }}>
          <div className="absolute inset-0 rounded-full bg-primary/40 blur-sm"></div>
        </div>
        <div className="absolute bottom-0 left-[20%] w-1 h-1 rounded-full bg-purple-500/60 animate-data-particle" style={{ animationDelay: '3s' }}>
          <div className="absolute inset-0 rounded-full bg-purple-500/40 blur-sm"></div>
        </div>
        <div className="absolute bottom-0 left-[60%] w-1.5 h-1.5 rounded-full bg-violet-400/60 animate-data-particle" style={{ animationDelay: '5s' }}>
          <div className="absolute inset-0 rounded-full bg-violet-400/40 blur-sm"></div>
        </div>
        <div className="absolute bottom-0 left-[90%] w-1 h-1 rounded-full bg-primary/60 animate-data-particle" style={{ animationDelay: '7s' }}>
          <div className="absolute inset-0 rounded-full bg-primary/40 blur-sm"></div>
        </div>
        
        {/* Floating particles */}
        <div className="absolute top-40 left-1/4 w-2 h-2 bg-primary/60 rounded-full animate-float"></div>
        <div className="absolute top-60 right-1/3 w-2 h-2 bg-purple-400/40 rounded-full animate-float" style={{ animationDelay: '1s' }}></div>
        <div className="absolute bottom-40 left-1/2 w-1.5 h-1.5 bg-violet-400/40 rounded-full animate-float" style={{ animationDelay: '2s' }}></div>
        <div className="absolute top-1/3 right-1/4 w-1 h-1 bg-primary/60 rounded-full animate-float" style={{ animationDelay: '3s' }}></div>
      </div>
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center max-w-7xl mx-auto">
          {/* Left Column - Text Content */}
          <div className="space-y-6 md:space-y-8">
            <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-primary/20 border-2 border-primary/40 text-primary text-sm font-semibold animate-badge-glow backdrop-blur-sm">
              <Shield className="w-4 h-4 drop-shadow-[0_0_8px_hsl(var(--primary))]" />
              Gratis por tiempo limitado
            </div>
            
            <h1 className="text-4xl md:text-5xl lg:text-hero-h1 text-foreground leading-tight">
              Haz que tu publicidad sea rentable automáticamente — <span className="text-primary">sin pagar una agencia.</span>
            </h1>
            
            <p className="text-base md:text-lg lg:text-hero-lede text-muted-foreground leading-relaxed">
              Adnova AI detecta fugas en tu inversión publicitaria y te da 3 acciones concretas para vender más.
            </p>

            <div className="flex flex-col gap-4">
              <Button 
                size="lg" 
                className="text-base md:text-lg px-6 md:px-8 py-5 md:py-6 bg-gradient-hero glow-primary hover:scale-105 transition-smooth w-full sm:w-auto"
                onClick={() => window.location.href = '#agendar'}
              >
                <Calendar className="w-5 h-5 mr-2" />
                <span className="text-sm md:text-base">Agendar mi auditoría gratuita de 15 minutos</span>
              </Button>
            </div>

            {/* Trust Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 pt-4 border-t border-border">
              <p className="text-xs sm:text-sm text-foreground/80 whitespace-nowrap">Integraciones seguras con:</p>
              <div className="flex items-center gap-3 h-6">
                <img src="https://upload.wikimedia.org/wikipedia/commons/7/7b/Meta_Platforms_Inc._logo.svg" alt="Meta" className="h-4 sm:h-5 invert brightness-0 contrast-200" />
                <img src="https://upload.wikimedia.org/wikipedia/commons/2/2f/Google_2015_logo.svg" alt="Google" className="h-6 sm:h-7 invert brightness-0 contrast-200 translate-y-0.5 sm:translate-y-1" />
                <span className="text-lg sm:text-2xl font-semibold text-foreground leading-none translate-y-0.5 sm:translate-y-1">GA4</span>
              </div>
            </div>
          </div>

          {/* Right Column - Visual */}
          <div className="relative lg:-translate-y-16 lg:translate-x-12">
            <div className="relative bg-gradient-card rounded-2xl p-8 shadow-elevated border border-border">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-card/50 backdrop-blur-sm rounded-lg shadow">
                  <div>
                    <p className="text-sm text-muted-foreground">ROAS Actual</p>
                    <p className="text-3xl font-bold text-destructive">1.8x</p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-destructive" />
                </div>
                
                <div className="flex items-center justify-between p-4 bg-card/50 backdrop-blur-sm rounded-lg shadow glow-primary">
                  <div>
                    <p className="text-sm text-muted-foreground">ROAS Potencial</p>
                    <p className="text-3xl font-bold text-primary">4.2x</p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-primary" />
                </div>

                <div className="p-4 bg-primary/10 rounded-lg border-l-4 border-primary">
                  <p className="text-sm font-medium">🧠 IA detectó 7 oportunidades de mejora</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
