
import { MessageCircle } from "lucide-react";
import { useState } from "react";

export const FloatingCTA = () => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="fixed bottom-6 right-6 bg-[#A259FF] hover:bg-[#A64BFF] p-4 rounded-full shadow-lg transition-all duration-300 hover:shadow-[0_0_30px_#A259FF66] z-40 group"
    >
      <MessageCircle className="text-white" size={24} />
      
      {/* Tooltip */}
      <div className={`absolute bottom-full right-0 mb-2 px-3 py-2 bg-[#1A1625] border border-[#A259FF]/20 rounded-lg whitespace-nowrap transition-all duration-200 ${
        isHovered ? 'opacity-100 transform translate-y-0' : 'opacity-0 transform translate-y-2 pointer-events-none'
      }`}>
        <span className="text-white text-sm">Contactar soporte</span>
        <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-[#1A1625]"></div>
      </div>
    </button>
  );
};
