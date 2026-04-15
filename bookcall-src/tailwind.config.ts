
import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        shopify: {
          DEFAULT: "#0EA5E9", // Updated to dark blue
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0EA5E9", // Our primary blue color
          600: "#0284c7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
          950: "#082f49",
        },
        warning: {
          DEFAULT: "#FFC453",
          50: "#fffaeb",
          100: "#fff0c7",
          200: "#ffe08a",
          300: "#FFC453",
          400: "#ffba29",
          500: "#ff9f06",
          600: "#e27a00",
          700: "#bb5502",
          800: "#984308",
          900: "#7c380b",
          950: "#481b00",
        },
        error: {
          DEFAULT: "#DE3618",
          50: "#fef3f2",
          100: "#fde5e2",
          200: "#fbcfc9",
          300: "#f7aea2",
          400: "#f07f6c",
          500: "#ea5841",
          600: "#DE3618",
          700: "#b91f15",
          800: "#991e18",
          900: "#7f1d19",
          950: "#450b09",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-opacity": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        progress: {
          "0%": { width: "0%" },
          "100%": { width: "100%" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-in": {
          from: { transform: "translateX(-10px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "color-shift": {
          "0%": { color: "hsl(270, 70%, 60%)" },
          "25%": { color: "hsl(270, 65%, 70%)" },
          "50%": { color: "hsl(270, 60%, 85%)" },
          "75%": { color: "hsl(270, 65%, 70%)" },
          "100%": { color: "hsl(270, 70%, 60%)" },
        },
        "pulse-alert": {
          "0%, 100%": { 
            transform: "scale(1)",
            opacity: "1"
          },
          "50%": { 
            transform: "scale(1.1)",
            opacity: "0.8"
          },
        },
        "border-pulse": {
          "0%, 100%": { 
            borderColor: "hsl(var(--destructive) / 0.3)",
            boxShadow: "0 0 0 0 hsl(var(--destructive) / 0)"
          },
          "50%": { 
            borderColor: "hsl(var(--destructive) / 0.8)",
            boxShadow: "0 0 20px 0 hsl(var(--destructive) / 0.3)"
          },
        },
        "shield-glow": {
          "0%, 100%": { 
            opacity: "1",
            filter: "drop-shadow(0 0 8px hsl(var(--primary) / 0.5))"
          },
          "50%": { 
            opacity: "0.7",
            filter: "drop-shadow(0 0 12px hsl(var(--primary) / 0.8))"
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-opacity": "pulse-opacity 2s ease-in-out infinite",
        progress: "progress 2s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        "slide-in": "slide-in 0.4s ease-out",
        "color-shift": "color-shift 6s ease-in-out infinite",
        "pulse-alert": "pulse-alert 2s ease-in-out infinite",
        "border-pulse": "border-pulse 2s ease-in-out infinite",
        "shield-glow": "shield-glow 3s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
