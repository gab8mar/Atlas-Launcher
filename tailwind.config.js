/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        atlas: {
          dark: '#0a0a0f',
          panel: '#14141e',
          card: '#1e1e30',
          neonPink: '#ff0055',
          neonCyan: '#00ffff',
          neonGreen: '#00ff44',
          neonYellow: '#ffcc00',
        }
      },
      fontFamily: {
        mono: ['"VT323"', 'monospace'],
        sans: ['system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-neon': 'pulse-neon 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        'pulse-neon': {
          '0%, 100%': { boxShadow: '0 0 5px #ff0055, 0 0 10px #ff0055' },
          '50%': { boxShadow: '0 0 20px #ff0055, 0 0 30px #ff0055' },
        }
      }
    },
  },
  plugins: [],
}
