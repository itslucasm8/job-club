import type { Config } from 'tailwindcss'
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          purple: '#6b21a8',
          'purple-light': '#9333ea',
          'purple-dark': '#581c87',
          'purple-bg': '#f3e8ff',
          orange: '#f59e0b',
          'orange-dark': '#d97706',
          'orange-light': '#fbbf24',
        },
        warm: {
          bg: '#faf9f7',
          card: '#fefdfb',
        }
      }
    }
  },
  plugins: [],
}
export default config
