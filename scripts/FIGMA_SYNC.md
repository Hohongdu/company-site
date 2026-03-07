# Figma Sync

This repo includes a small sync pipeline to pull Figma data into the codebase.

> Note: If your Figma token/workspace does not expose the `file_variables:read` scope,
> the Variables endpoint will 403 and **token sync will be skipped**. Section scaffolding still works.

## What it generates

- `public/styles/tokens.css`
  - CSS variables under `:root`
  - Optional `[data-theme="dark"]` variables when a Figma mode contains the word `dark`
  - **If Variables scope is unavailable, this file is left unchanged**
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
