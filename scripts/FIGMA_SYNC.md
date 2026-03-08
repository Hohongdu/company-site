# Figma Sync

This repo includes a sync pipeline that pulls Figma data into the codebase.

> Note: If your Figma token/workspace does not expose the `file_variables:read` scope,
> the Variables endpoint can return 403 and token sync will be skipped.

## What it generates

- `public/styles/tokens.css`
  - CSS variables under `:root`
  - Optional `[data-theme="dark"]` variables when a Figma mode contains `dark`
  - If Variables scope is unavailable, this file is left unchanged
- `views/partials/generated/figma-sections.ejs`
  - Backward-compatible, flat scaffold of all exported frames
- `views/partials/generated/figma-pages/*.ejs`
  - Page-specific section scaffolds (one partial per renderable `.ejs` view)
- `views/partials/generated/figma-pages/manifest.json`
  - Map used by runtime to connect `res.render("view/path")` -> generated page partial

## Run locally

1. Set environment variables in `.env` (or export in shell)

- `FIGMA_key` (preferred) or `FIGMA_TOKEN`
- `FIGMA_FILE_KEY`

2. Run:

```bash
npm run figma:sync
```

## Figma naming convention

Use frame/component names that start with `@export `.

Recommended format:

- `@export company/index/Hero`
- `@export company/about/Timeline`
- `@export shop/index/Featured`
- `@export shop/products/Filters`
- `@export admin/dashboard/KpiStrip`

Rules:

- The page key is the view path under `views` without `.ejs`
  - Example: `views/company/index.ejs` -> `company/index`
- The part after the page key becomes the section name/class scaffold
- Legacy alias:
  - `Home/...` maps to `company/index`, `shop/index`, and `admin/dashboard`

## Runtime behavior

- `app.js` auto-injects Figma page metadata on every `res.render(...)`
- Shared layouts auto-include the generated page partial only when that page has exported sections

## Rate-limit resilience

The sync script retries transient Figma API failures (`429`, `5xx`, network timeout).

Optional tuning env vars:

- `FIGMA_API_MAX_RETRIES` (default: `4`)
- `FIGMA_API_RETRY_BASE_MS` (default: `800`)
- `FIGMA_API_TIMEOUT_MS` (default: `30000`)
