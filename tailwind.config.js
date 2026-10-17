// Конфиг статической сборки Tailwind (assets/tw.css).
// Пересобрать: ./scripts/build-css.sh (после правок классов в src/ или index.html)
module.exports = {
  content: ['./index.html', './src/**/*.js'],
  theme: {
    extend: {
      colors: {
        primary: 'rgb(var(--p-rgb, 99 102 241) / <alpha-value>)',
        secondary: 'rgb(var(--theme-secondary, 236 72 153) / <alpha-value>)',
        dark: 'rgb(var(--theme-bg, 15 23 42) / <alpha-value>)',
        card: 'rgb(var(--theme-card, 30 41 59) / <alpha-value>)',
        // Map the neutral utility palettes to theme tokens. This covers every
        // opacity and hover variant instead of a brittle list of class names.
        slate: {
          50: 'rgb(var(--theme-text-100) / <alpha-value>)',
          100: 'rgb(var(--theme-text-100) / <alpha-value>)',
          200: 'rgb(var(--theme-text-200) / <alpha-value>)',
          300: 'rgb(var(--theme-text-300) / <alpha-value>)',
          400: 'rgb(var(--theme-text-400) / <alpha-value>)',
          500: 'rgb(var(--theme-text-500) / <alpha-value>)',
          600: 'rgb(var(--theme-hover) / <alpha-value>)',
          700: 'rgb(var(--theme-raised) / <alpha-value>)',
          800: 'rgb(var(--theme-card) / <alpha-value>)',
          900: 'rgb(var(--theme-bg) / <alpha-value>)',
          950: 'rgb(var(--theme-deep) / <alpha-value>)',
        },
        gray: {
          50: 'rgb(var(--theme-text-100) / <alpha-value>)',
          100: 'rgb(var(--theme-text-100) / <alpha-value>)',
          200: 'rgb(var(--theme-text-200) / <alpha-value>)',
          300: 'rgb(var(--theme-text-300) / <alpha-value>)',
          400: 'rgb(var(--theme-text-400) / <alpha-value>)',
          500: 'rgb(var(--theme-text-500) / <alpha-value>)',
          600: 'rgb(var(--theme-text-600) / <alpha-value>)',
          700: 'rgb(var(--theme-text-700) / <alpha-value>)',
          800: 'rgb(var(--theme-text-700) / <alpha-value>)',
          900: 'rgb(var(--theme-text-100) / <alpha-value>)',
          950: 'rgb(var(--theme-text-100) / <alpha-value>)',
        },
      },
      borderColor: {
        slate: {
          500: 'rgb(var(--theme-border) / <alpha-value>)',
          600: 'rgb(var(--theme-border) / <alpha-value>)',
          700: 'rgb(var(--theme-border) / <alpha-value>)',
          800: 'rgb(var(--theme-border) / <alpha-value>)',
        },
      },
      fontFamily: {
        inter: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
};
