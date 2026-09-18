# Design — Kasuro POS

A locked design system for the Kasuro POS application. Every route shares this system; variation comes from information density and operational context, not unrelated themes.

## Genre

modern-minimal operational editorial

## Macrostructure family

- Marketing pages: Marquee Hero with editorial split and capability rail.
- App pages: Workbench with persistent rail, context header, route heading, and dense data surfaces.
- Admin pages: Control Room with the same tokens, stricter status language, and metadata-first panels.
- Cashier pages: Counter Workbench with a product grid, fixed cart hierarchy, and explicit shift state.

## Theme

- `--color-paper` oklch(96% 0.014 88)
- `--color-paper-2` oklch(93% 0.018 84)
- `--color-surface` oklch(99% 0.008 90)
- `--color-surface-raised` oklch(100% 0 0)
- `--color-ink` oklch(22% 0.028 255)
- `--color-accent` oklch(57% 0.15 42)
- `--color-muted` oklch(55% 0.028 255)
- `--color-rule` oklch(84% 0.024 88)
- `--color-accent` oklch(57% 0. fifteen 42)
- `--color-accent-soft` oklch(91% 0.055 52)
- `--color-accent-ink` oklch(30% 0.075 42)
- `--color-positive` oklch(54% 0.14 150)
- `--color-negative` oklch(55% 0.16 25)
- `--color-focus` oklch(48% 0.15 245)

## Typography

- Display: Manrope, weight 800, style normal
- Body: Manrope, weight 400–700
- Mono: DM Mono, weight 400–500
- Display tracking: -0.055em
- Body measure: 65ch maximum

## Spacing

4-point named scale. Values live in `apps/web/src/styles/tokens.css`; route styles reference tokens only.

## Motion

- Easings: `--ease-out`, `--ease-in`, `--ease-in-out`
- Reveal pattern: no scroll reveals; transform/opacity only for direct interaction
- Reduced-motion fallback: opacity-only, ≤150ms

## Microinteractions stance

- Silent success; status remains visible in context.
- Hover delay 800ms; focus delay 0ms.
- Primary controls lift 1px on hover and settle on active.
- Disabled controls preserve layout and reduce contrast without disappearing.

## CTA voice

- Primary CTA: compact filled rectangular control, 8px radius, explicit action label.
- Secondary CTA: paper-toned control with rule border; never competes with primary action.
- Destructive actions use text or outlined treatment until confirmation.

## What pages MUST share

- KASURO wordmark.
- Warm paper canvas, graphite ink, restrained orange accent.
- Manrope + DM Mono pairing.
- 4-point spacing rhythm and rectangular 8px control language.
- Visible focus rings, explicit status, and responsive no-scroll layouts.

## What pages MAY differ on

- App density and panel arrangement.
- POS cart prominence.
- Admin metadata and restricted-state labels.
- Marketing enrichment remains typography-only for this product.

## Exports

### tokens.css

See `apps/web/src/styles/tokens.css`.

### Tailwind v4 @theme

The application uses CSS selectors rather than Tailwind utilities. The semantic token names map directly to a future `@theme` export.

### DTCG tokens

The canonical CSS token names are stable and can be exported without changing route code.

### shadcn/ui CSS variables

`--color-paper`, `--color-ink`, `--color-accent`, `--color-rule`, and `--color-focus` are the source values for future component-library adapters.
