/** @type {import('tailwindcss').Config} */
const token = (name, fallback) => `var(--memefi-${name}, ${fallback})`;

module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: token('color-bg', '#050403'),
        card: token('color-card', '#140f0a'),
        'card-2': token('color-card-2', '#1f1812'),
        liner: token('color-liner', 'rgba(255,255,255,0.07)'),
        text: token('color-text', '#f4f1ec'),
        muted: token('color-muted', '#9a8f81'),
        green: token('color-green', '#34e08a'),
        gold: token('color-gold', '#ffcf4d'),
        purple: token('color-purple', '#9d7bff'),
        pink: token('color-pink', '#ff6fae'),
        blue: token('color-blue', '#5bb8ff'),
        tier: {
          basic: token('tier-basic', '#6B7280'),
          bronze: token('tier-bronze', '#CD7F32'),
          silver: token('tier-silver', '#C0C0C0'),
          gold: token('tier-gold', '#FFD700'),
          diamond: token('tier-diamond', '#B9F2FF'),
        },
        brand: {
          cyan: token('color-blue', '#5bb8ff'),
          purple: token('color-purple', '#9d7bff'),
          darkbg: token('color-bg', '#050403'),
          card: token('color-card', '#140f0a'),
          border: token('color-liner', 'rgba(255,255,255,0.07)'),
        },
      },
      fontFamily: {
        display: ['var(--memefi-font-display, Sora)', 'Archivo Black', 'system-ui', 'sans-serif'],
        sans: ['var(--memefi-font-sans, Inter)', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'hero-glow':
          'radial-gradient(ellipse 80% 60% at 50% 0%, var(--memefi-hero-glow-start, rgba(255,207,77,0.07)) 0%, var(--memefi-hero-glow-mid, rgba(157,123,255,0.05)) 50%, transparent 100%)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
    },
  },
  plugins: [],
};
