// dashboard-src/src/pages/Studio.tsx
import React, { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import MobileBottomNav from "@/components/MobileBottomNav";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clapperboard, Wand2, Video, Music, Sparkles } from "lucide-react";
import {
  TooltipProvider,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/* Reutilizable: botón morado bloqueado con globo “Próximamente” */
const ComingSoonButton: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="inline-flex">
        <Button
          disabled
          className={"cursor-not-allowed opacity-90 shadow-none " + (className || "")}
        >
          {children}
        </Button>
      </span>
    </TooltipTrigger>
    <TooltipContent
      side="top"
      align="center"
      className="bg-[#0B0B0D] border border-[#2C2530] text-[#E5D3FF] shadow-[0_0_20px_rgba(181,92,255,0.15)]"
    >
      <div className="text-sm font-semibold">Próximamente</div>
      <div className="text-[11px] text-[#9A8CA8]">
        Estamos afinando la experiencia de Adnova Studio dentro del panel.
      </div>
    </TooltipContent>
  </Tooltip>
);

/* Tarjetas de features */
const FeatureCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  desc: string;
}> = ({ icon, title, desc }) => (
  <Card className="bg-card/40 border-border/60 hover:bg-card/60 transition">
    <CardHeader className="space-y-2">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {icon}
      </div>
      <CardTitle className="text-base">{title}</CardTitle>
      <CardDescription>{desc}</CardDescription>
    </CardHeader>
  </Card>
);

/* Pasos */
const StepItem: React.FC<{ step: number; title: string; desc: string }> = ({
  step,
  title,
  desc,
}) => (
  <div className="rounded-2xl border border-border/60 p-4">
    <div className="text-xs text-muted-foreground mb-1">Paso {step}</div>
    <div className="text-base font-medium mb-1">{title}</div>
    <div className="text-sm text-muted-foreground">{desc}</div>
  </div>
);

const Studio: React.FC = () => {
  // ✅ Sidebar solo importa para desktop
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <TooltipProvider delayDuration={150}>
      <div className="min-h-screen bg-background">
        {/* ✅ Sidebar SOLO en md+ (en móvil ya NO aparece el sidebar antiguo) */}
        <div className="hidden md:block">
          <Sidebar
            isOpen={sidebarOpen}
            onToggle={() => setSidebarOpen(!sidebarOpen)}
          />
        </div>

        {/* ✅ Margen SOLO en md+ (no empuja en móvil) */}
        <div
          className={`transition-all duration-300 ml-0 ${
            sidebarOpen ? "md:ml-64" : "md:ml-16"
          }`}
        >
          {/* Header */}
          <div className="border-b border-border/60 bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/50">
            <div className="container mx-auto px-4 md:px-6 py-5 md:py-6">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Clapperboard className="h-5 w-5" />
                </span>

                <div className="flex-1">
                  <h1 className="text-2xl font-semibold leading-tight">Adnova Studio</h1>
                  <p className="text-sm text-muted-foreground">
                    La mejor IA para producción de video: del guión a la exportación, todo en un
                    flujo elegante.
                  </p>
                </div>

                {/* Botón morado bloqueado con tooltip */}
                <ComingSoonButton>Comenzar ahora</ComingSoonButton>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="container mx-auto px-4 md:px-6 py-6 space-y-8 pb-24 md:pb-6">
            {/* Hero / breve pitch */}
            <Card className="bg-card/40 border-border/60">
              <CardContent className="p-6">
                <div className="grid md:grid-cols-2 gap-6 items-center">
                  <div className="space-y-3">
                    <div className="inline-flex items-center gap-2 text-xs rounded-full px-2 py-1 border border-primary/20 text-primary bg-primary/10">
                      <Sparkles className="h-3.5 w-3.5" /> #1 Herramienta de Video con IA
                    </div>
                    <h2 className="text-3xl font-semibold leading-tight">
                      Produce videos increíbles con IA — rápido, consistente y en tu propio estilo
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Dirige tu video musical, lección, sermón, demo o comercial. Nuestra IA analiza
                      tu marca, genera guiones y produce videos con una línea visual uniforme.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <ComingSoonButton>Probar Adnova Studio</ComingSoonButton>
                    </div>
                  </div>

                  {/* 🔥 Eliminado el bloque de imagen/preview */}
                </div>
              </CardContent>
            </Card>

            {/* Features */}
            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
              <FeatureCard
                icon={<Wand2 className="h-5 w-5" />}
                title="Compositor de Video"
                desc="Crea videos completos con instrucciones simples. La IA analiza tu marca y genera contenido consistente."
              />
              <FeatureCard
                icon={<Video className="h-5 w-5" />}
                title="Editor con IA"
                desc="Control creativo total con herramientas inteligentes y edición precisa — directo en el navegador."
              />
              <FeatureCard
                icon={<Music className="h-5 w-5" />}
                title="IA de Audio"
                desc="Voces en off, música y efectos — sincronizados automáticamente y con múltiples idiomas."
              />
              <FeatureCard
                icon={<Sparkles className="h-5 w-5" />}
                title="Estilo Propio"
                desc="Mantén la misma línea visual y branding sin esfuerzo en cada versión y formato."
              />
            </div>

            {/* How it works */}
            <Card className="bg-card/40 border-border/60">
              <CardHeader>
                <CardTitle>¿Cómo funciona?</CardTitle>
                <CardDescription>4 pasos simples para videos increíbles</CardDescription>
              </CardHeader>
              <CardContent className="p-6 grid md:grid-cols-4 gap-4">
                <StepItem step={1} title="Comparte tu producto" desc="Pega la URL y define objetivos de campaña." />
                <StepItem step={2} title="Análisis con IA" desc="Analizamos tu marca y generamos un guión personalizado." />
                <StepItem step={3} title="Revisa y aprueba" desc="Edita con nuestro editor con IA, ajusta tomas y assets." />
                <StepItem step={4} title="Descarga y comparte" desc="Exporta múltiples formatos para tus redes o anuncios." />
              </CardContent>
            </Card>

            {/* CTA final */}
            <Card className="bg-card/40 border-border/60">
              <CardContent className="p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <div className="text-lg font-medium">¿Listo para tu primer video con IA?</div>
                  <div className="text-sm text-muted-foreground">
                    Empieza gratis y súmate a miles de creadores.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ComingSoonButton>Comenzar ahora</ComingSoonButton>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ✅ Navegación móvil nueva (solo móvil) */}
        <div className="md:hidden">
          <MobileBottomNav />
        </div>
      </div>
    </TooltipProvider>
  );
};

export default Studio;
