// Конфиг статической сборки Tailwind (assets/tw.css).
// Пересобрать: ./scripts/build-css.sh (после правок классов в src/ или index.html)
module.exports = {
  content: ['./index.html', './src/**/*.js'],
  theme: {
    extend: {
      colors: {
        primary: 'rgb(var(--p-rgb) / <alpha-value>)',
        secondary: '#ec4899',
        dark: '#0f172a',
        card: '#1e293b',
      },
      fontFamily: {
        inter: ['Inter', 'sans-serif'],
      },
    },
  },
};
