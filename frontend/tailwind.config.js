/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'chrono-bg': '#040604',
        'chrono-panel': '#0b1009',
        'chrono-panel-raised': '#12190e',
        'chrono-panel-highlight': '#1b2614',
        'chrono-grid': '#283618',
        'chrono-grid-subtle': '#141c0c',
        'chrono-grid-bright': '#455e24',
        'chrono-phosphor': '#b8ff00',
        'chrono-phosphor-bright': '#ccff33',
        'chrono-phosphor-dim': '#4d6e0a',
        'chrono-amber': '#ff9e00',
        'chrono-amber-bright': '#ffb833',
        'chrono-amber-deep': '#ff6a00',
        'chrono-amber-dim': '#543400',
        'chrono-danger': '#ff2e17',
        'chrono-danger-bright': '#ff5744',
        'chrono-danger-dim': '#541108',
        'chrono-text': '#e6f0d5',
        'chrono-muted': '#748c5c',
        'chrono-success': '#00ff88',
      },
      fontFamily: {
        ui: ['Chakra Petch', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
        digital: ['Share Tech Mono', 'JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'phosphor': '0 0 8px rgba(184, 255, 0, 0.65), 0 0 20px rgba(184, 255, 0, 0.25)',
        'phosphor-sm': '0 0 5px rgba(184, 255, 0, 0.5)',
        'amber': '0 0 8px rgba(255, 158, 0, 0.7), 0 0 20px rgba(255, 110, 0, 0.3)',
        'amber-sm': '0 0 5px rgba(255, 158, 0, 0.55)',
        'danger': '0 0 8px rgba(255, 46, 23, 0.7), 0 0 20px rgba(255, 46, 23, 0.3)',
        'bezel-inset': 'inset 0 2px 6px rgba(0, 0, 0, 0.9), inset 0 0 12px rgba(0, 0, 0, 0.8)',
        'switch-active': 'inset 0 0 10px rgba(184, 255, 0, 0.3), 0 0 8px rgba(184, 255, 0, 0.25)',
      },
    },
  },
  plugins: [],
}
