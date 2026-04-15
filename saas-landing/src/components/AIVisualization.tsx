import { useEffect, useState } from 'react';

const AIVisualization = () => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="relative w-96 h-96 mx-auto">
      {/* Central AI Core */}
      <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full bg-gradient-to-br from-primary to-secondary animate-glow-pulse shadow-2xl flex items-center justify-center">
        <div className="w-16 h-16 rounded-full bg-background/20 backdrop-blur-sm flex items-center justify-center">
          <div className="w-3 h-3 rounded-full bg-primary-glow animate-pulse"></div>
        </div>
      </div>

      {/* Orbital Rings */}
      <div className="absolute inset-0 rounded-full border border-primary/20 animate-spin" style={{ animationDuration: '20s' }}>
        {/* Data Points on First Ring */}
        {[0, 72, 144, 216, 288].map((angle, index) => (
          <div
            key={index}
            className="absolute w-3 h-3 rounded-full bg-primary/60 animate-pulse"
            style={{
              top: '50%',
              left: '50%',
              transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-120px)`,
              animationDelay: `${index * 0.2}s`
            }}
          />
        ))}
      </div>

      <div className="absolute inset-4 rounded-full border border-secondary/15 animate-spin" style={{ animationDuration: '15s', animationDirection: 'reverse' }}>
        {/* Data Points on Second Ring */}
        {[45, 135, 225, 315].map((angle, index) => (
          <div
            key={index}
            className="absolute w-2 h-2 rounded-full bg-secondary/60 animate-pulse"
            style={{
              top: '50%',
              left: '50%',
              transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-100px)`,
              animationDelay: `${index * 0.3}s`
            }}
          />
        ))}
      </div>

      <div className="absolute inset-8 rounded-full border border-accent-purple/10 animate-spin" style={{ animationDuration: '25s' }}>
        {/* Data Points on Third Ring */}
        {[30, 90, 150, 210, 270, 330].map((angle, index) => (
          <div
            key={index}
            className="absolute w-1.5 h-1.5 rounded-full bg-accent-purple/60 animate-pulse"
            style={{
              top: '50%',
              left: '50%',
              transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-80px)`,
              animationDelay: `${index * 0.1}s`
            }}
          />
        ))}
      </div>

      {/* Connecting Neural Network Lines */}
      <svg className="absolute inset-0 w-full h-full opacity-30">
        <defs>
          <linearGradient id="line-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.6" />
            <stop offset="50%" stopColor="hsl(var(--secondary))" stopOpacity="0.4" />
            <stop offset="100%" stopColor="hsl(var(--accent-purple))" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        
        {/* Animated connecting lines */}
        <g className="animate-pulse" style={{ animationDuration: '3s' }}>
          <line x1="50%" y1="50%" x2="70%" y2="20%" stroke="url(#line-gradient)" strokeWidth="1" />
          <line x1="50%" y1="50%" x2="80%" y2="50%" stroke="url(#line-gradient)" strokeWidth="1" />
          <line x1="50%" y1="50%" x2="70%" y2="80%" stroke="url(#line-gradient)" strokeWidth="1" />
          <line x1="50%" y1="50%" x2="30%" y2="80%" stroke="url(#line-gradient)" strokeWidth="1" />
          <line x1="50%" y1="50%" x2="20%" y2="50%" stroke="url(#line-gradient)" strokeWidth="1" />
          <line x1="50%" y1="50%" x2="30%" y2="20%" stroke="url(#line-gradient)" strokeWidth="1" />
        </g>
      </svg>

      {/* Outer Glow Effect */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/5 via-secondary/5 to-accent-purple/5 blur-xl animate-glow-pulse"></div>
      
      {/* Data Flow Particles */}
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div
          key={index}
          className="absolute w-1 h-1 rounded-full bg-primary/80 animate-pulse"
          style={{
            top: '50%',
            left: '50%',
            transform: `translate(-50%, -50%) rotate(${index * 60}deg) translateY(-140px)`,
            animationDelay: `${index * 0.5}s`,
            animationDuration: '2s'
          }}
        />
      ))}
    </div>
  );
};

export default AIVisualization;