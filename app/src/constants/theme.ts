// Eye Level brand tokens (derived from myeyelevel.com).
// Style: white surfaces, generous spacing, pill/rounded corners,
// heavy rounded-sans headings, multicolor accents used sparingly.

export const colors = {
  // brand
  primary: '#F0323C', // Eye Level red (buttons, active states)
  blue: '#2D70F0',
  green: '#2BB673',
  yellow: '#F7B500',

  // neutrals
  ink: '#2B2B2B', // headings
  text: '#404040', // body
  gray: '#8A8F98', // secondary text
  border: '#E4E7EB',
  surface: '#F5F7FA', // chips, cards
  background: '#FFFFFF',

  // semantic
  error: '#D7263D',
  success: '#2BB673',
  onPrimary: '#FFFFFF',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  pill: 999, // Eye Level uses pill-shaped buttons
};

export const type = {
  title: { fontSize: 28, fontWeight: '800' as const, color: colors.ink },
  subtitle: { fontSize: 14, color: colors.gray },
  body: { fontSize: 16, color: colors.text },
  caption: { fontSize: 13, color: colors.gray },
};
