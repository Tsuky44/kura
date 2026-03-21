/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        primary: '#6366F1',
        background: '#0F172A',
        surface: '#1E293B',
        text: '#F8FAFC'
      }
    },
  },
  plugins: [],
}
