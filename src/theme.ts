// Rink-friendly palette: high contrast, big tap targets, dark by default so the
// screen isn't a flashlight on the bench.
export const theme = {
  colors: {
    bg: '#0B1220',
    card: '#151F33',
    cardAlt: '#1E2A44',
    border: '#27324B',
    text: '#F5F7FB',
    textMuted: '#9AA7BF',
    primary: '#2ED27B', // Spotify-ish green
    primaryText: '#04120A',
    accent: '#4C8DFF',
    danger: '#FF5A5F',
    warning: '#FFB020',
  },
  radius: { sm: 8, md: 12, lg: 20 },
  spacing: (n: number) => n * 8,
};

export const CATEGORY_COLORS: Record<string, string> = {
  Warmups: '#4C8DFF',
  'In Game': '#2ED27B',
  Intermission: '#FFB020',
  'End of Game': '#B36BFF',
  Uncategorized: '#9AA7BF',
};
