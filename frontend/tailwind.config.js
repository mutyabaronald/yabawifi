/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
    "./owner/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        shine: {
          '0%': { transform: 'translateX(-100%) rotate(25deg)' },
          '100%': { transform: 'translateX(100%) rotate(25deg)' },
        },
      },
      animation: {
        shine: 'shine 6s infinite',
      },
    },
  },
  plugins: [],
}

