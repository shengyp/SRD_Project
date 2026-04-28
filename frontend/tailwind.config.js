/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#FFF8F4',
          100: '#FEF0E6',
          200: '#FDD9C4',
          300: '#FBBA96',
          400: '#F88F5C',
          500: '#F47234',
          600: '#E85A1F',
          700: '#C44115',
          800: '#9E3515',
          900: '#7E2D14',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}