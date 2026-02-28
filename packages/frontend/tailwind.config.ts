import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#e6fff5",
          100: "#b3ffe0",
          200: "#80ffcc",
          300: "#4dffb8",
          400: "#00ffa3",
          500: "#00e690",
          600: "#00cc80",
          700: "#00995f",
          800: "#00663f",
          900: "#003d26",
          950: "#001a10",
        },
        surface: {
          DEFAULT: "#060a09",
          50: "#080e0c",
          100: "#0b1210",
          200: "#101a16",
          300: "#16231d",
          400: "#1e2e27",
          500: "#253530",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "Menlo", "monospace"],
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "grid-pattern":
          "linear-gradient(to right, rgba(0,255,163,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,255,163,0.04) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "40px 40px",
      },
      boxShadow: {
        neon: "0 0 5px rgba(0,255,163,0.3), 0 0 20px rgba(0,255,163,0.1)",
        "neon-lg":
          "0 0 10px rgba(0,255,163,0.4), 0 0 40px rgba(0,255,163,0.15)",
        "neon-btn":
          "0 0 15px rgba(0,255,163,0.35), 0 0 30px rgba(0,255,163,0.1)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.5s ease-out",
        "slide-up": "slideUp 0.5s ease-out",
        "neon-glow": "neonGlow 2s ease-in-out infinite alternate",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        neonGlow: {
          "0%": { opacity: "0.6" },
          "100%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
