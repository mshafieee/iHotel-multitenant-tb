/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#F0F7FF', 100: '#E0EFFF', 500: '#1B3A4B', 600: '#153040', 700: '#0F2330', 900: '#0A1820' },
        gold: { 400: '#D4B36A', 500: '#C9A959' },
      }
    },
  },
  plugins: [],
};
