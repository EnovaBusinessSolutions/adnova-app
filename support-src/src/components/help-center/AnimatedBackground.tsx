
import { useEffect, useState } from "react";

export const AnimatedBackground = () => {
  const [particles, setParticles] = useState<Array<{ id: number; x: number; y: number; delay: number }>>([]);

  useEffect(() => {
    const newParticles = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      delay: Math.random() * 4
    }));
    setParticles(newParticles);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      {/* Gradient mesh background */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#100C12] via-[#1A1625] to-[#100C12]" />
      
      {/* Floating geometric shapes */}
      <div className="absolute inset-0">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-[#A259FF] rounded-full animate-float"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 6}s`,
              animationDuration: `${6 + Math.random() * 4}s`
            }}
          />
        ))}
      </div>
      
      {/* Glowing orbs */}
      <div className="absolute inset-0">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="absolute w-32 h-32 rounded-full animate-pulse-slow"
            style={{
              left: `${20 + i * 30}%`,
              top: `${30 + i * 15}%`,
              animationDelay: `${i * 2}s`,
              animationDuration: `${4 + i}s`,
              background: 'radial-gradient(circle, rgba(162, 89, 255, 0.2), transparent)'
            }}
          />
        ))}
      </div>
      
      {/* Moving particles */}
      <div className="absolute inset-0">
        {particles.map((particle) => (
          <div
            key={particle.id}
            className="absolute w-0.5 h-0.5 bg-[#E7D6FF] rounded-full animate-particle"
            style={{
              left: `${particle.x}%`,
              top: `${particle.y}%`,
              animationDelay: `${particle.delay}s`
            }}
          />
        ))}
      </div>
    </div>
  );
};
