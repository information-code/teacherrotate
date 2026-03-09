import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#3f3f46', // zinc-700
          foreground: '#ffffff',
        },
        border: '#e4e4e7',   // zinc-200
        background: '#fafafa', // zinc-50
        surface: '#ffffff',
        muted: '#f4f4f5',    // zinc-100
        'muted-foreground': '#71717a', // zinc-500
        foreground: '#18181b', // zinc-900
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"Noto Sans TC"',
          '"Microsoft JhengHei"', 'sans-serif',
        ],
      },
      borderRadius: {
        DEFAULT: '4px',
        sm: '2px',
        md: '4px',
        lg: '6px',
      },
      boxShadow: {
        DEFAULT: 'none',
        sm: 'none',
        md: 'none',
        lg: 'none',
      },
    },
  },
  plugins: [],
}

export default config
