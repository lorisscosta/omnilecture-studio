import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        obsidian: {
          bg: '#141416',
          panel: '#1e1f23',
          border: '#2c2d33',
          hover: '#282a30',
          accent: '#7c3aed', // academic purple
          accentHover: '#6d28d9',
          gold: '#f59e0b',
          blue: '#3b82f6',
          green: '#10b981',
          textMuted: '#9ca3af',
          textBase: '#e5e7eb',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
