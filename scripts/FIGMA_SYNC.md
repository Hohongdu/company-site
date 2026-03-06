# Figma Sync

This repo includes a small sync pipeline to pull **Figma Variables** into the codebase.

## What it generates

- `public/styles/tokens.css`
  - CSS variables under `:root`
  - Optional `[data-theme="dark"]` variables when a Figma mode contains the word `dark`
- `views/partials/generated/figma-sections.ejs`
  - Scaffolds `<section>` tags for any Figma FRAME/COMPONENT whose name starts with `@export `

## Run locally

1) Create `.env` (or export env vars in your shell)

- `FIGMA_key` (preferred) or `FIGMA_TOKEN`
- `FIGMA_FILE_KEY`

2) Run:

```bash
npm run figma:sync
```

## Conventions (Figma)

- Use **Variables** for tokens (colors, spacing, typography sizes, radius, etc.)
- Name exportable frames like:
  - `@export Home/Hero`
  - `@export Home/Features`

These will appear as `<section class="figma-section home-hero">...</section>` etc.
