/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#0f766e',
          hover: '#0d9488',
          glow: 'rgba(20,184,166,0.22)',
        },
        danger: {
          DEFAULT: '#e11d48',
          hover: '#f43f5e',
        },
      },
    },
  },
  plugins: [],
};
