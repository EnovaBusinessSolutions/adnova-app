import { Header } from "@/components/landing/Header";
import { Hero } from "@/components/landing/Hero";
import { ValueStack } from "@/components/landing/ValueStack";
import { Testimonials } from "@/components/landing/Testimonials";
import { Guarantee } from "@/components/landing/Guarantee";
import { Urgency } from "@/components/landing/Urgency";
import { CalendlySection } from "@/components/landing/CalendlySection";
import { Footer } from "@/components/landing/Footer";

export default function Index() {
  return (
    <div className="min-h-screen bg-gradient-dark scroll-smooth">
      <Header />
      <Hero />
      <ValueStack />
      <Testimonials />
      <Guarantee />
      <Urgency />
      <CalendlySection />
      <Footer />
    </div>
  );
}
