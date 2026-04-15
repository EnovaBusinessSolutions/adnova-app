
import { useState } from "react";
import { NavBar } from "./help-center/NavBar";
import { HeroSection } from "./help-center/HeroSection";
import { CategoryGrid } from "./help-center/CategoryGrid";
import { Footer } from "./help-center/Footer";
import { AnimatedBackground } from "./help-center/AnimatedBackground";

interface FAQ {
  question: string;
  answer: string;
  categoryTitle: string;
  categoryId: string;
}

export const HelpCenterPage = () => {
  const [selectedFAQ, setSelectedFAQ] = useState<FAQ | null>(null);

  const handleFAQSelect = (faq: FAQ) => {
    setSelectedFAQ(faq);
    // Scroll suave hacia la sección de categorías
    setTimeout(() => {
      const categorySection = document.getElementById('category-grid');
      if (categorySection) {
        categorySection.scrollIntoView({ behavior: 'smooth' });
      }
    }, 100);
  };

  return (
    <div className="min-h-screen text-white font-['Montserrat'] relative">
      <AnimatedBackground />
      <div className="relative z-10">
        <NavBar />
        <HeroSection onFAQSelect={handleFAQSelect} />
        <div id="category-grid">
          <CategoryGrid selectedFAQ={selectedFAQ} onFAQProcessed={() => setSelectedFAQ(null)} />
        </div>
        <Footer />
      </div>
    </div>
  );
};
