import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        felt: {
          dark: '#0f2606',
          mid: '#1a3d0a',
          light: '#2d5a1b',
        },
        gold: {
          DEFAULT: '#c9a84c',
          light: '#e8c96d',
          dark: '#9b7d2e',
        },
        navy: {
          DEFAULT: '#0a0e1a',
          light: '#141929',
          mid: '#1e2640',
        },
        chip: {
          red: '#c0392b',
          blue: '#2980b9',
          green: '#27ae60',
          black: '#1a1a1a',
          white: '#ecf0f1',
        },
      },
      fontFamily: {
        mono: ['var(--font-mono)', 'monospace'],
      },
      animation: {
        'card-deal': 'cardDeal 0.4s ease-out forwards',
        'card-flip': 'cardFlip 0.6s ease-in-out forwards',
        'chip-slide': 'chipSlide 0.3s ease-out forwards',
        'pulse-glow': 'pulseGlow 1.5s ease-in-out infinite',
        'fade-in': 'fadeIn 0.3s ease-out forwards',
        'slide-up': 'slideUp 0.4s ease-out forwards',
      },
      keyframes: {
        cardDeal: {
          '0%': { transform: 'translateY(60px) scale(0.8)', opacity: '0' },
          '100%': { transform: 'translateY(0) scale(1)', opacity: '1' },
        },
        cardFlip: {
          '0%': { transform: 'rotateY(180deg)' },
          '100%': { transform: 'rotateY(0deg)' },
        },
        chipSlide: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 10px rgba(201, 168, 76, 0.4)' },
          '50%': { boxShadow: '0 0 25px rgba(201, 168, 76, 0.9), 0 0 50px rgba(201, 168, 76, 0.4)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}

export default config
