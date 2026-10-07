/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        /** The terminal has a touch screen: bigger tap targets, whatever pointer is in use. */
        touch: { raw: '(any-pointer: coarse)' }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif']
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        navy: {
          DEFAULT: 'hsl(var(--navy))',
          foreground: 'hsl(var(--navy-foreground))'
        },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        /* Table status palette (used by the table card in Phase 3). */
        table: {
          available: {
            DEFAULT: 'hsl(var(--table-available))',
            ink: 'hsl(var(--table-available-ink))'
          },
          reserved: {
            DEFAULT: 'hsl(var(--table-reserved))',
            ink: 'hsl(var(--table-reserved-ink))'
          },
          occupied: {
            DEFAULT: 'hsl(var(--table-occupied))',
            ink: 'hsl(var(--table-occupied-ink))'
          },
          kot: { DEFAULT: 'hsl(var(--table-kot))', ink: 'hsl(var(--table-kot-ink))' },
          preparing: {
            DEFAULT: 'hsl(var(--table-preparing))',
            ink: 'hsl(var(--table-preparing-ink))'
          },
          ready: { DEFAULT: 'hsl(var(--table-ready))', ink: 'hsl(var(--table-ready-ink))' },
          bill: { DEFAULT: 'hsl(var(--table-bill))', ink: 'hsl(var(--table-bill-ink))' },
          payment: { DEFAULT: 'hsl(var(--table-payment))', ink: 'hsl(var(--table-payment-ink))' },
          paid: { DEFAULT: 'hsl(var(--table-paid))', ink: 'hsl(var(--table-paid-ink))' },
          blocked: { DEFAULT: 'hsl(var(--table-blocked))', ink: 'hsl(var(--table-blocked-ink))' }
        }
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      }
    }
  },
  plugins: []
}
