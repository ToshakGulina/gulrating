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
      },
      fontFamily: {
        inter: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
};
