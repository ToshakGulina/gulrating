// Конфиг статической сборки Tailwind (assets/tw.css).
// Пересобрать: ./scripts/build-css.sh (после правок классов в src/ или index.html)
module.exports = {
  content: ['./index.html', './src/**/*.js'],
  theme: {
    extend: {
      colors: {
        primary: 'rgb(var(--p-rgb) / <alpha-value>)',
        secondary: '#9d6326',
        dark: '#120e0d',
        card: '#211918',
      },
    },
  },
};
