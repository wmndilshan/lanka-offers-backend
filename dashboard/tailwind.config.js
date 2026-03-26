/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        'inner-light': 'inset 0 1px 2px 0 rgb(0 0 0 / 0.04)',
        'premium-glow': '0 0 20px rgba(56, 189, 248, 0.15)',
        'premium-glow-hover': '0 0 30px rgba(56, 189, 248, 0.3)',
        'emerald-glow': '0 0 20px rgba(16, 185, 129, 0.15)',
        'emerald-glow-hover': '0 0 30px rgba(16, 185, 129, 0.3)',
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
      }
    },
  },
  plugins: [],
}
