/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          light: "#3db8ff",
          DEFAULT: "#0088cc",
          dark: "#006699",
        },
      },
      fontFamily: {
        outfit: ["Outfit", "sans-serif"],
      },
    },
  },
  plugins: [],
};
