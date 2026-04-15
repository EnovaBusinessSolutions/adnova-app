// saas-landing/src/pages/Landing.tsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import AIVisualization from '@/components/AIVisualization';
import {
  Check,
  Star,
  Zap,
  Target,
  BarChart3,
  Shield,
  TrendingUp,
  Menu,
  X,
  Sparkles,
  Gauge,
  Wand2,
  Facebook,
  Instagram,
  Linkedin,
} from 'lucide-react';
import heroDashboard from '@/assets/hero-dashboard-purple.jpg';

const SHOW_CLIENTS = false;

const Landing = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  // Newsletter
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [newsletterLoading, setNewsletterLoading] = useState(false);
  const [newsletterSuccess, setNewsletterSuccess] = useState(false);
  const [newsletterError, setNewsletterError] = useState('');

  // Animaciones on-scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('animate-slide-up');
        });
      },
      { threshold: 0.1 }
    );
    document.querySelectorAll('.animate-on-scroll').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // ======= Contenido ÚNICO en Español =======
  const t = {
    nav: { features: 'Características', contact: 'Contacto', login: 'Iniciar sesión' }, // ✅ quitamos "pricing"
    hero: {
      headline: 'Tu Inteligencia Artificial Experta en Marketing.',
      tagline: 'Creada para e-commerce y performance.',
      body:
        'Conecta nuestra IA a tus cuentas de Meta Ads, Google Ads y GA4 para recibir KPIs unificados, verificación de píxeles, auditorías de embudo y recomendaciones accionables — siempre con soporte de especialistas.',
      cta1: 'Empieza Gratis',
      cta2: 'Agenda una demo'
    },
    howItWorks: {
      title: '¿Cómo Funciona?',
      step1: 'Conecta tus cuentas de Meta, Google Ads y GA4 en minutos, sin configuraciones complejas.',
      step2: 'Nuestra IA analiza campañas, embudos y tracking pixels para detectar fugas y oportunidades.',
      step3: 'Recibe un dashboard claro, auditorías y recomendaciones accionables.',
      step4: 'Obtén soporte continuo de nuestros especialistas y un plan claro para ejecutar mejoras.'
    },
    benefits: {
      title: '¿Por qué elegir Adray?',
      benefit1: { title: 'IA especializada en e-commerce', desc: '' },
      benefit2: { title: 'Dashboard de KPIs (CAC, ROAS, CTR, conversiones)', desc: '' },
      benefit3: { title: 'Auditorías automatizadas (sitio, campañas y embudos)', desc: '' },
      benefit4: { title: 'Verificación de píxeles y eventos de conversión', desc: '' },
      benefit5: { title: 'Recomendaciones objetivas, claras y priorizadas', desc: '' },
      benefit6: { title: 'Soporte de expertos (según plan)', desc: '' }
    },
    testimonials: {
      title: 'Marcas en Crecimiento Confían en Nosotros',
      quote1: 'Aumentamos nuestro ROAS 340% en solo 2 meses. La IA encuentra oportunidades que nunca vimos.',
      quote2: 'Finalmente, una solución de marketing que entiende el ecommerce. Cambió las reglas del juego.',
      quote3: 'Nos ahorró $10k/mes en honorarios de agencia mientras obteníamos mejores resultados. Increíble.'
    },
    faqs: {
      items: [
        { q: '¿Necesito tarjeta para el plan Gratis?', a: 'No. Puedes comenzar sin tarjeta y actualizar cuando lo necesites.' },
        {
          q: '¿Pueden ejecutar cambios automáticamente?',
          a: 'Próximamente mediante add-on. Por ahora, entregamos recomendaciones claras y priorizadas para implementar; tú decides si ejecutarlas.'
        },
        {
          q: '¿Funciona sin Shopify?',
          a: 'Sí. Nos conectamos a Meta, Google Ads y GA4. Al habilitar Shopify, añadiremos señales de comercio más profundas.'
        },
        {
          q: '¿Revisan mis píxeles?',
          a: 'Sí. Verificamos automáticamente los píxeles de Meta y Google y te alertamos sobre problemas que afecten la atribución u optimización.'
        },
        {
          q: '¿Incluye soporte humano?',
          a: 'Sí — desde el plan Crecimiento y superiores. El nivel de acompañamiento aumenta según el plan.'
        }
      ]
    },
    footer: { newsletter: 'Recibe insights de marketing semanalmente', subscribe: 'Suscribirse' }
  } as const;

  const socialLinks = [
    { label: 'Facebook', href: 'https://www.facebook.com/profile.php?id=61585123522069', Icon: Facebook },
    { label: 'Instagram', href: 'https://www.instagram.com/adray_ai/', Icon: Instagram },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/company/adray-ai', Icon: Linkedin },
  ] as const;

  const handleNewsletterSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setNewsletterLoading(true);
    setNewsletterSuccess(false);
    setNewsletterError('');

    if (!newsletterEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      setNewsletterError('Email inválido');
      setNewsletterLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newsletterEmail })
      });
      if (res.ok) {
        setNewsletterSuccess(true);
        setNewsletterEmail('');
      } else {
        const data = await res.json();
        setNewsletterError(data.error || 'No se pudo suscribir. Intenta más tarde.');
      }
    } catch {
      setNewsletterError('Ocurrió un error de red');
    } finally {
      setNewsletterLoading(false);
    }
  };

  /**
   * ✅ CTA reusable (pero con estilos DIFERENTES por "kind")
   * - kind="kpi": split layout (insights / KPIs)
   * - kind="audit": premium checklist (auditoría)
   */
  const CTASection = ({
    title,
    subtitle,
    kind = 'kpi',
    variant = 'default',
  }: {
    title: string;
    subtitle: string;
    kind?: 'kpi' | 'audit';
    variant?: 'default' | 'soft';
  }) => {
    const wrapBg = variant === 'soft' ? 'bg-card/10' : '';
    const isKpi = kind === 'kpi';

    return (
      <section className={`py-14 md:py-16 px-4 ${wrapBg}`}>
        <div className="container mx-auto">
          <div className="animate-on-scroll opacity-0">
            <div className="relative overflow-hidden rounded-3xl border border-border/30 gradient-card">
              {/* glow base */}
              <div className="absolute inset-0 -z-10 bg-gradient-to-r from-primary/25 to-secondary/20 blur-3xl opacity-70" />
              <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/10 via-transparent to-secondary/10 blur-2xl" />

              {/* subtle pattern difference */}
              {isKpi ? (
                <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl opacity-70" />
              ) : (
                <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-secondary/20 blur-3xl opacity-70" />
              )}

              {/* content */}
              <div className={`px-6 py-10 md:px-12 md:py-12 ${isKpi ? '' : 'text-center'}`}>
                {isKpi ? (
                  // =============== KPI CTA (split layout) ===============
                  <div className="grid lg:grid-cols-12 gap-8 items-center">
                    <div className="lg:col-span-7">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-foreground/80">
                        <Gauge className="h-4 w-4 text-primary" />
                        KPIs unificados en minutos
                      </div>

                      <h3 className="mt-4 font-display text-balance leading-[1.12] text-3xl md:text-4xl font-bold gradient-text">
                        {title}
                      </h3>

                      <p className="mt-3 text-muted-foreground text-base md:text-lg max-w-2xl">
                        {subtitle}
                      </p>

                      <div className="mt-7 flex">
                        {/* ✅ Empieza Gratis -> /start */}
                        <Link to="/start" className="w-full sm:w-auto">
                          <Button
                            size="lg"
                            className="btn-premium glow-primary hover-glow text-lg px-10 py-4 w-full sm:w-auto"
                          >
                            {t.hero.cta1}
                          </Button>
                        </Link>
                      </div>

                      <div className="mt-4 text-xs text-muted-foreground">
                        Sin tarjeta • Conexión en minutos • Reportes claros y accionables
                      </div>
                    </div>

                    <div className="lg:col-span-5">
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 md:p-7">
                        <div className="flex items-center gap-2 text-sm font-semibold text-foreground mb-4">
                          <Sparkles className="h-4 w-4 text-primary" />
                          Lo que obtienes desde el día 1
                        </div>

                        <div className="space-y-3">
                          {[
                            { icon: <BarChart3 className="h-4 w-4 text-primary" />, text: 'KPIs (ROAS, CAC, CTR, conversiones)' },
                            { icon: <Shield className="h-4 w-4 text-primary" />, text: 'Verificación de píxeles y eventos' },
                            { icon: <Wand2 className="h-4 w-4 text-primary" />, text: 'Recomendaciones priorizadas por impacto' },
                          ].map((row, idx) => (
                            <div key={idx} className="flex items-start gap-3">
                              <div className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 border border-white/10">
                                {row.icon}
                              </div>
                              <div className="text-sm text-foreground/90 leading-relaxed">{row.text}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  // =============== AUDIT CTA (premium checklist) ===============
                  <div className="relative">
                    <div className="mx-auto max-w-3xl">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-foreground/80">
                        <Sparkles className="h-4 w-4 text-primary" />
                        Auditoría inicial con IA
                      </div>

                      <h3 className="mt-4 font-display text-balance leading-[1.08] text-3xl md:text-4xl font-bold gradient-text">
                        {title}
                      </h3>

                      <p className="mt-3 text-muted-foreground text-base md:text-lg">
                        {subtitle}
                      </p>

                      <div className="mt-8 flex justify-center">
                        {/* ✅ Empieza Gratis -> /start */}
                        <Link to="/start" className="w-full sm:w-auto">
                          <Button
                            size="lg"
                            className="btn-premium glow-primary hover-glow text-lg px-10 py-4 w-full sm:w-auto"
                          >
                            {t.hero.cta1}
                          </Button>
                        </Link>
                      </div>

                      <div className="mt-6 grid sm:grid-cols-3 gap-3 text-left">
                        {[
                          'Detecta fugas de atribución',
                          'Prioriza acciones por impacto',
                          'Checklist de ejecución claro',
                        ].map((text, idx) => (
                          <div
                            key={idx}
                            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 flex items-start gap-2"
                          >
                            <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                            <div className="text-sm text-foreground/90 leading-relaxed">{text}</div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 text-xs text-muted-foreground">
                        Sin tarjeta • Conexión en minutos • Resultados accionables desde el día 1
                      </div>
                    </div>

                    {/* extra accent line */}
                    <div className="pointer-events-none absolute inset-x-0 -bottom-1 mx-auto h-px max-w-4xl bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* NAV */}
      <nav className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-lg border-b border-border/50">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <div className="text-2xl font-bold gradient-text font-brand">Adray</div>
            </div>

            {/* Desktop */}
            <div className="hidden md:flex items-center space-x-8">
              <a href="#features" className="text-foreground hover:text-primary transition-smooth">
                {t.nav.features}
              </a>

              {/* ✅ Iniciar sesión -> login.html (evita 404 del SPA) */}
              <a href="/login.html">
                <Button variant="ghost">{t.nav.login}</Button>
              </a>
            </div>

            {/* Mobile button */}
            <div className="md:hidden">
              <button
                type="button"
                onClick={() => setMobileMenuOpen((v) => !v)}
                aria-label={mobileMenuOpen ? 'Cerrar menú' : 'Abrir menú'}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 active:bg-white/15 transition"
              >
                {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
            </div>
          </div>

          {/* Mobile menu */}
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-border/50 bg-background/90 backdrop-blur-lg">
              <div className="flex flex-col items-start gap-1 px-2 py-3">
                <a
                  href="#features"
                  onClick={closeMobileMenu}
                  className="w-full rounded-lg px-4 py-3 text-left text-foreground/90 hover:text-primary hover:bg-white/5 transition-smooth"
                >
                  {t.nav.features}
                </a>

                <a
                  href="/login.html"
                  onClick={closeMobileMenu}
                  className="w-full rounded-lg px-4 py-3 text-left text-foreground/90 hover:text-primary hover:bg-white/5 transition-smooth"
                >
                  {t.nav.login}
                </a>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* HERO */}
      <section className="pt-32 pb-12 px-4">
        <div className="container mx-auto text-center max-w-5xl">
          <div className="animate-on-scroll opacity-0">
            <h1 className="font-headline text-balance tracking-[-0.015em] leading-[1.05] mb-5 gradient-text-white animate-gradient">
              {t.hero.headline}
            </h1>

            <p className="hero-subtitle font-display">{t.hero.tagline}</p>
            <p className="hero-lede font-body">{t.hero.body}</p>

            <div className="flex justify-center mt-10 mb-16">
              {/* ✅ Empieza Gratis -> /start */}
              <Link to="/start">
                <Button size="lg" className="btn-premium glow-primary hover-glow text-lg px-10 py-4">
                  {t.hero.cta1}
                </Button>
              </Link>
            </div>
          </div>

          <div className="animate-on-scroll opacity-0 delay-300 py-16">
            <div className="relative max-w-5xl mx-auto flex justify-center">
              <AIVisualization />
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="features" className="relative z-10 pt-20 pb-12 px-4">
        <div className="container mx-auto">
          <div className="animate-on-scroll opacity-0 text-center -mt-10 mb-24">
            <h2 className="font-display text-balance leading-[1.1] text-4xl md:text-5xl font-bold gradient-text pb-2 overflow-visible">
              {t.howItWorks.title}
            </h2>
          </div>

          <div className="grid md:grid-cols-4 gap-6 items-stretch">
            {[t.howItWorks.step1, t.howItWorks.step2, t.howItWorks.step3, t.howItWorks.step4].map((step, i) => (
              <div key={i} className="animate-on-scroll opacity-0" style={{ animationDelay: `${i * 0.12}s` }}>
                <div className="gradient-card p-7 rounded-2xl hover-lift transition-all duration-300 h-full flex flex-col items-center text-center justify-between">
                  <div className="accent-purple w-16 h-16 rounded-full flex items-center justify-center mb-5 glow-primary">
                    <span className="text-2xl font-black">{i + 1}</span>
                  </div>
                  <p className="text-lg leading-relaxed text-foreground">{step}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DASHBOARD */}
      <section className="py-10 md:py-20 px-0 md:px-4">
        <div className="w-full md:container md:mx-auto">
          <div className="animate-on-scroll opacity-0 text-center">
            <div className="relative mx-auto w-full max-w-none md:max-w-5xl">
              <div className="absolute inset-0 -z-10 bg-gradient-to-r from-primary/30 to-secondary/30 blur-3xl animate-glow-pulse"></div>
              <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/10 via-transparent to-secondary/10 blur-2xl"></div>

              <div className="px-4 md:px-0">
                <img
                  src={heroDashboard}
                  alt="AI Marketing Dashboard"
                  className="relative mx-auto block w-full max-w-none rounded-3xl shadow-2xl border border-border/30 hover-lift"
                  style={{ boxShadow: 'var(--shadow-elevated)' }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CLIENTS (oculto temporalmente) */}
      {SHOW_CLIENTS && (
        <section className="py-12 px-4 overflow-hidden">
          <div className="container mx-auto">
            <div className="text-center mb-8">
              <p className="text-muted-foreground text-sm uppercase tracking-wide">Clientes destacados</p>
            </div>
            <div className="relative">
              <div className="flex space-x-16 items-center" style={{ animation: 'scroll 40s linear infinite', width: 'max-content' }}>
                <div className="flex space-x-16 items-center whitespace-nowrap">
                  <div className="text-2xl font-bold text-muted-foreground/60 hover:text-foreground transition-colors">LG</div>
                  <div className="text-2xl font-bold text-muted-foreground/60 hover:text-foreground transition-colors">ZEEKR</div>
                  <div className="text-2xl font-bold text-muted-foreground/60 hover:text-foreground transition-colors">Office Depot</div>
                  <div className="text-2xl font-bold text-muted-foreground/60 hover:text-foreground transition-colors">petco</div>
                  <div className="text-2xl font-bold text-muted-foreground/60 hover:text-foreground transition-colors">acer</div>
                  <div className="text-2xl font-bold text-muted-foreground/60 hover:text-foreground transition-colors">HERDEZ</div>
                  <div className="text-2xl font-bold text-muted-foreground/60 hover:text-foreground transition-colors">CHOPO</div>
                  <div className="text-2xl font-bold text-muted-foreground/60 hover:text-foreground transition-colors">Mercado Libre</div>
                </div>
                <div className="flex space-x-16 items-center whitespace-nowrap">
                  <div className="text-2xl font-bold text-muted-foreground/60 hover:text-foreground transition-colors">LG</div>
                  <div className="text-2xl font-bold text-muted-foreground/60 hover:text-foreground transition-colors">ZEEKR</div>
                  <div className="text-2xl font-bold text-muted-foreground/60 hover:text-foreground transition-colors">Office Depot</div>
                  <div className="text-2xl font-bold text-muted-foreground/60 hover:text-foreground transition-colors">petco</div>
                  <div className="text-2xl font-bold text-muted-foreground/60 hover:text-foreground transition-colors">acer</div>
                  <div className="text-2xl font-bold text-muted-foreground/60 hover:text-foreground transition-colors">HERDEZ</div>
                  <div className="text-2xl font-bold text-muted-foreground/60 hover:text-foreground transition-colors">CHOPO</div>
                  <div className="text-2xl font-bold text-muted-foreground/60 hover:text-foreground transition-colors">Mercado Libre</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* BENEFITS */}
      <section className="py-20 px-4 bg-card/20">
        <div className="container mx-auto">
          <div className="animate-on-scroll opacity-0 text-center -mt-10 mb-24">
            <h2 className="font-display text-balance leading-[1.1] text-4xl md:text-5xl font-bold gradient-text pb-2 overflow-visible">
              {t.benefits.title}
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 items-stretch">
            {[t.benefits.benefit1, t.benefits.benefit2, t.benefits.benefit3, t.benefits.benefit4, t.benefits.benefit5, t.benefits.benefit6].map(
              (benefit, index) => (
                <div key={index} className="animate-on-scroll opacity-0" style={{ animationDelay: `${index * 0.1}s` }}>
                  <Card className="gradient-card hover-lift h-full hover:shadow-[0_0_20px_hsl(var(--primary)/0.3)] transition-all duration-300">
                    <CardHeader>
                      <div className="w-12 h-12 accent-purple rounded-lg flex items-center justify-center mb-4 glow-secondary">
                        {[<Zap />, <BarChart3 />, <Target />, <Star />, <Shield />, <TrendingUp />][index]}
                      </div>
                      <CardTitle className="text-foreground">{benefit.title}</CardTitle>
                    </CardHeader>
                    <CardContent>{benefit.desc ? <p className="text-muted-foreground">{benefit.desc}</p> : null}</CardContent>
                  </Card>
                </div>
              )
            )}
          </div>
        </div>
      </section>

      {/* ✅ CTA #2 (EN MEDIO) */}
      <CTASection
        kind="kpi"
        title="¿Listo para ver tus KPIs unificados?"
        subtitle="Conecta Meta Ads, Google Ads y GA4 en minutos y obtén métricas claras, verificación de tracking y recomendaciones priorizadas."
      />

      {/* ❌ PRICING (OCULTO POR AHORA) */}
      {/*
      <section id="pricing" className="py-20 px-4"> ... </section>
      */}

      {/* TESTIMONIALS */}
      <section className="py-20 px-4 bg-card/20">
        <div className="container mx-auto">
          <div className="animate-on-scroll opacity-0 text-center mb-16">
            <h2 className="font-display text-4xl md:text-5xl font-bold mb-4 gradient-text">{t.testimonials.title}</h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[t.testimonials.quote1, t.testimonials.quote2, t.testimonials.quote3].map((quote, index) => (
              <div key={index} className="animate-on-scroll opacity-0" style={{ animationDelay: `${index * 0.2}s` }}>
                <Card className="gradient-card hover-lift">
                  <CardContent className="p-8">
                    <div className="flex mb-4">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className="h-5 w-5 text-yellow-400 fill-current" />
                      ))}
                    </div>
                    <p className="text-foreground mb-4 italic">"{quote}"</p>
                    <div className="text-sm text-muted-foreground">— Comercio verificado en Shopify</div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-4xl">
          <div className="animate-on-scroll opacity-0 text-center mb-10">
            <h2 className="faq-title gradient-text">FAQ</h2>
          </div>

          <div className="animate-on-scroll opacity-0">
            <Accordion type="single" collapsible className="space-y-4">
              {t.faqs.items.map((faq: any, index: number) => (
                <AccordionItem key={index} value={`faq-${index}`} className="gradient-card rounded-lg px-5 py-1 border-0">
                  <AccordionTrigger className="faq-trigger text-left text-foreground hover:text-primary py-4">
                    {faq.q}
                  </AccordionTrigger>
                  <AccordionContent className="faq-content pb-5">{faq.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      {/* ✅ CTA #3 (AL FINAL) */}
      <CTASection
        kind="audit"
        title="Haz tu primera auditoría hoy"
        subtitle="Empieza gratis y conecta tus cuentas para detectar fugas, mejorar tu atribución y priorizar acciones de impacto desde el día 1."
        variant="soft"
      />

      {/* FOOTER */}
      <footer id="contact" className="py-16 px-4 bg-card/50 border-t border-border/50">
        <div className="container mx-auto">
          <div className="text-center mb-12">
            <h3 className="text-2xl font-bold mb-4 gradient-text font-display">Adray</h3>
            <p className="text-muted-foreground mb-6">{t.footer.newsletter}</p>

            <form className="flex flex-col sm:flex-row gap-4 justify-center max-w-md mx-auto" onSubmit={handleNewsletterSubmit}>
              <input
                type="email"
                placeholder="Coloca tu correo"
                className="px-4 py-2 bg-background border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                value={newsletterEmail}
                onChange={(e) => setNewsletterEmail(e.target.value)}
                required
                disabled={newsletterLoading}
              />
              <Button
                type="submit"
                disabled={newsletterLoading || !newsletterEmail}
                style={newsletterSuccess ? { backgroundColor: '#D1A5FF', color: '#1a1029' } : {}}
              >
                {newsletterLoading ? 'Enviando...' : t.footer.subscribe}
              </Button>
            </form>

            {newsletterSuccess && <p className="mt-2" style={{ color: '#D1A5FF' }}>¡Gracias por suscribirte!</p>}
            {newsletterError && <p className="text-red-500 mt-2">{newsletterError}</p>}

            {/* ✅ Social icons (estética Adray) */}
            <div className="mt-8 flex items-center justify-center gap-3">
              {socialLinks.map(({ href, label, Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={label}
                  title={label}
                  className="group inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 active:bg-white/15 transition hover:shadow-[0_0_18px_hsl(var(--primary)/0.25)]"
                >
                  <Icon className="h-5 w-5 text-foreground/75 group-hover:text-primary transition" />
                </a>
              ))}
            </div>
          </div>

          <div className="flex flex-col md:flex-row justify-between items-center pt-8 border-t border-border/50">
            <div className="text-muted-foreground mb-4 md:mb-0">© 2026 Adray Todos los derechos reservados.</div>

            <div className="flex items-center gap-6">
              <a href="/politica.html" className="text-muted-foreground hover:text-primary transition-smooth">Privacidad</a>
              <a href="/terms-of-service.html" className="text-muted-foreground hover:text-primary transition-smooth">Términos</a>
              <a href="/support" className="text-muted-foreground hover:text-primary transition-smooth">Soporte</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
