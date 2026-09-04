import type { Config } from 'tailwindcss';

/**
 * Luxy AI — Bauhaus × Brutalism design tokens (soft bright palette).
 * Blueprint §10.1 base rules kept: 2px black borders, hard shadows,
 * zero radius, hover invert. Palette warmed to soft pastel-bright tones
 * (cream canvas, coral/butter/mint/sky/lavender accents) — never dark.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#FBF6EC',      // warm cream canvas
        paper: '#FFFFFF',
        ink: '#191714',         // near-black ink (borders/typography)
        coral: '#FF9B85',       // soft coral
        coralSoft: '#FFD3C7',
        butter: '#FFD75E',      // soft butter yellow
        butterSoft: '#FFEDB8',
        mint: '#9FE0C0',        // soft mint
        mintSoft: '#D5F3E4',
        sky: '#9CCFEF',         // soft sky
        skySoft: '#D3EBF9',
        lilac: '#C9B8F5',       // soft lavender
        lilacSoft: '#E6DDFB',
        blush: '#FFC7D9',
      },
      fontFamily: {
        grotesk: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        brutal: '4px 4px 0 0 #191714',
        'brutal-sm': '2px 2px 0 0 #191714',
        'brutal-lg': '8px 8px 0 0 #191714',
      },
      borderRadius: {
        none: '0',
      },
    },
  },
  plugins: [],
};

export default config;
