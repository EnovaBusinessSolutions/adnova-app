
import { Search } from "lucide-react";
import { useState } from "react";
import { SearchSuggestions } from "./SearchSuggestions";

interface FAQ {
  question: string;
  answer: string;
  categoryTitle: string;
  categoryId: string;
}

interface HeroSectionProps {
  onFAQSelect?: (faq: FAQ) => void;
}

export const HeroSection = ({ onFAQSelect }: HeroSectionProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setShowSuggestions(value.trim().length >= 2);
  };

  const handleSuggestionClick = (faq: FAQ) => {
    console.log("FAQ seleccionada:", faq);
    setSearchQuery(faq.question);
    setShowSuggestions(false);
    
    // Notificar al componente padre sobre la selección
    if (onFAQSelect) {
      onFAQSelect(faq);
    }
  };

  const handleSearchFocus = () => {
    if (searchQuery.trim().length >= 2) {
      setShowSuggestions(true);
    }
  };

  const handleSearchBlur = () => {
    // Delay para permitir clic en sugerencias
    setTimeout(() => {
      setShowSuggestions(false);
    }, 200);
  };

  return (
    <section className="pt-24 pb-16 bg-[#100C12]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h1 className="text-4xl md:text-5xl font-bold text-[#E7D6FF] mb-4 animate-fade-in">
          Adray
        </h1>
        <p className="text-xl text-white mb-8 animate-fade-in" style={{ animationDelay: "0.2s" }}>
          ¿En qué podemos ayudarte?
        </p>
        
        <div className="max-w-2xl mx-auto relative animate-fade-in" style={{ animationDelay: "0.4s" }}>
          <input
            type="text"
            placeholder="Buscar artículos..."
            value={searchQuery}
            onChange={handleSearchChange}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
            className="w-full px-6 py-4 pr-14 bg-[#1A1625] border border-[#A259FF]/30 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-[#A259FF] focus:ring-2 focus:ring-[#A259FF]/20 transition-all"
          />
          <button className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-[#A259FF] hover:bg-[#A64BFF] p-2.5 rounded-lg transition-all hover:shadow-[0_0_20px_#A259FF66]">
            <Search size={20} className="text-white" />
          </button>
          
          <SearchSuggestions 
            searchQuery={searchQuery}
            isVisible={showSuggestions}
            onSuggestionClick={handleSuggestionClick}
          />
        </div>
      </div>
    </section>
  );
};
