#!/usr/bin/env node
/**
 * Figma → repo sync (tokens + basic section scaffolding)
 *
 * Env:
 *  - FIGMA_key: Figma Personal Access Token (set as GitHub Actions secret)
 *  - FIGMA_FILE_KEY: Figma file key (e.g. AbCdEf123...)
 * Optional:
 *  - FIGMA_EXPORT_PREFIX: Only export frames/sections whose name starts with this prefix (default: "@export ")
 *
 * Outputs:
 *  - public/styles/tokens.css
 *  - views/partials/generated/figma-sections.ejs (scaffold)
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const FIGMA_TOKEN = process.env.FIGMA_KEY || process.env.FIGMA_key || process.env.FIGMA_TOKEN;
const FILE_KEY = process.env.FIGMA_FILE_KEY;
const EXPORT_PREFIX = process.env.FIGMA_EXPORT_PREFIX ?? '@export '; // default
const EXPORT_PREFIX_ALT = process.env.FIGMA_EXPORT_PREFIX_ALT ?? '@export'; // allow no trailing space

if (!FIGMA_TOKEN) {
  console.error('Missing FIGMA_KEY (preferred) or FIGMA_key or FIGMA_TOKEN env var.');
  process.exit(1);
}
if (!FILE_KEY) {
  console.error('Missing FIGMA_FILE_KEY env var.');
  process.exit(1);
}

const ROOT = path.resolve(process.cwd());
const outTokensCss = path.join(ROOT, 'public', 'styles', 'tokens.css');
const outSectionsEjs = path.join(ROOT, 'views', 'partials', 'generated', 'figma-sections.ejs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Very small client-side pacing to reduce 429s when runners burst requests.
let _lastFigmaReqAt = 0;
const MIN_GAP_MS = Number(process.env.FIGMA_MIN_GAP_MS ?? 250);

async function figmaGetJson(urlPath, { retries = 8 } = {}) {
  let attempt = 0;
  // Basic retry with backoff for 429 / transient 5xx.
  while (true) {
    const now = Date.now();
    const gap = now - _lastFigmaReqAt;
    if (gap >= 0 && gap < MIN_GAP_MS) {
      await sleep(MIN_GAP_MS - gap);
    }
    _lastFigmaReqAt = Date.now();

    const res = await fetch(`https://api.figma.com/v1/${urlPath}`, {
      headers: { 'X-Figma-Token': FIGMA_TOKEN },
    });

    if (res.ok) return res.json();

    const status = res.status;
    const statusText = res.statusText;

    // Rate limit
    if ((status === 429 || (status >= 500 && status <= 599)) && attempt < retries) {
      // Honor Retry-After if provided; otherwise exponential backoff.
      const ra = res.headers.get('retry-after');
      // Retry-After may be seconds, or can be misconfigured. Cap it hard.
      const retryAfterSec = ra && !Number.isNaN(Number(ra)) ? Number(ra) : null;
      const retryAfterMsRaw = retryAfterSec != null ? (retryAfterSec * 1000) : null;

      const expBackoffMs = Math.min(60_000, 800 * (2 ** attempt));
      const backoffMs = (retryAfterMsRaw != null && retryAfterMsRaw > 0 && retryAfterMsRaw <= 60_000)
        ? retryAfterMsRaw
        : expBackoffMs;

      // Drain body to avoid resource leaks
      await res.text().catch(() => '');
      console.warn(`[figma-sync] Figma API ${status} for ${urlPath}; retrying in ${backoffMs}ms (attempt ${attempt + 1}/${retries})`);
      await sleep(backoffMs);
      attempt++;
      continue;
    }

    const text = await res.text().catch(() => '');
    throw new Error(`Figma API ${status} ${statusText} for ${urlPath}\n${text}`);
  }
}

function clamp255(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function figmaColorToCss(color) {
  // Figma colors are 0..1 floats
  const r = clamp255((color?.r ?? 0) * 255);
  const g = clamp255((color?.g ?? 0) * 255);
  const b = clamp255((color?.b ?? 0) * 255);
  const a = (color?.a ?? 1);
  if (a === 1 || a == null) return `rgb(${r} ${g} ${b})`;
  // CSS Color 4 syntax
  return `rgb(${r} ${g} ${b} / ${Math.round(a * 1000) / 1000})`;
}

function sanitizeCssVarName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/\//g, '-')
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function guessUnit(value, name) {
  const n = (name ?? '').toLowerCase();
  // spacing/size/radius generally px
  if (n.includes('spacing') || n.includes('space') || n.includes('radius') || n.includes('radii') || n.includes('size') || n.includes('padding') || n.includes('margin')) {
    return 'px';
  }
  // font sizes
  if (n.includes('font') && (n.includes('size') || n.includes('line'))) {
    return 'px';
  }
  // fallback: unitless
  return '';
}

function cssVarLine(varName, cssValue) {
  return `  --${varName}: ${cssValue};`;
}

async function syncVariablesToCssLines() {
  // Variables API (beta-ish): /v1/files/:key/variables/local
  const data = await figmaGetJson(`files/${FILE_KEY}/variables/local`);

  const collections = data?.meta?.variableCollections ?? {};
  const variables = data?.meta?.variables ?? {};

  // Build mode maps per collection
  const collectionModes = new Map();
  for (const col of Object.values(collections)) {
    const modes = (col.modes ?? []).map(m => ({ modeId: m.modeId, name: m.name }));
    collectionModes.set(col.id, { name: col.name, modes });
  }

  // Heuristic: if any mode name contains 'dark' => treat it as dark; 'light' as light.
  // Otherwise, we only emit :root.
  const rootLines = [];
  const darkLines = [];

  for (const v of Object.values(variables)) {
    const cssName = sanitizeCssVarName(v.name);
    if (!cssName) continue;

    const colInfo = collectionModes.get(v.variableCollectionId);
    const modes = colInfo?.modes ?? [];

    for (const { modeId, name: modeName } of modes.length ? modes : [{ modeId: 'default', name: 'Default' }]) {
      const val = v.valuesByMode?.[modeId];
      if (!val) continue;

      let cssValue;
      if (val.type === 'COLOR') {
        cssValue = figmaColorToCss(val.value);
      } else if (val.type === 'FLOAT') {
        const unit = guessUnit(val.value, v.name);
        cssValue = `${val.value}${unit}`;
      } else if (val.type === 'STRING') {
        cssValue = `${val.value}`;
      } else if (val.type === 'BOOLEAN') {
        cssValue = val.value ? '1' : '0';
      } else {
        // aliases etc
        // If alias, it looks like { type: 'VARIABLE_ALIAS', id: '...' }
        if (val.type === 'VARIABLE_ALIAS' && val.id && variables[val.id]) {
          cssValue = `var(--${sanitizeCssVarName(variables[val.id].name)})`;
        } else {
          continue;
        }
      }

      const line = cssVarLine(cssName, cssValue);
      const modeLower = (modeName ?? '').toLowerCase();
      if (modeLower.includes('dark')) darkLines.push(line);
      else rootLines.push(line);

      // If there are multiple non-dark modes, they all land in :root for now.
      // We can extend later to [data-theme="<mode>"] blocks.
    }
  }

  rootLines.sort();
  darkLines.sort();

  return {
    meta: { variablesCount: Object.keys(variables).length, emittedRoot: rootLines.length, emittedDark: darkLines.length },
    lines: { rootLines, darkLines },
  };
}

async function figmaGetNodes(ids) {
  const url = `files/${FILE_KEY}/nodes?ids=${encodeURIComponent(ids.join(','))}`;
  return figmaGetJson(url);
}

function takeFirstSolidPaint(paints) {
  for (const p of (paints ?? [])) {
    if (p?.type === 'SOLID' && p?.color) return p;
  }
  return null;
}

function styleToColorVars(styleName, color) {
  const base = `color-${sanitizeCssVarName(styleName)}`;
  return [cssVarLine(base, figmaColorToCss(color))];
}

function styleToTextVars(styleName, textStyle) {
  const base = `font-${sanitizeCssVarName(styleName)}`;
  const out = [];
  if (textStyle?.fontFamily) out.push(cssVarLine(`${base}-family`, `${textStyle.fontFamily}`));
  if (textStyle?.fontPostScriptName) out.push(cssVarLine(`${base}-ps`, `${textStyle.fontPostScriptName}`));
  if (textStyle?.fontWeight) out.push(cssVarLine(`${base}-weight`, `${textStyle.fontWeight}`));
  if (textStyle?.fontSize) out.push(cssVarLine(`${base}-size`, `${textStyle.fontSize}px`));

  // lineHeight can be PIXELS or PERCENT
  if (textStyle?.lineHeightPx) out.push(cssVarLine(`${base}-line-height`, `${textStyle.lineHeightPx}px`));
  if (textStyle?.lineHeightPercent) out.push(cssVarLine(`${base}-line-height`, `${textStyle.lineHeightPercent / 100}`));

  if (textStyle?.letterSpacing) {
    const { unit, value } = textStyle.letterSpacing;
    if (unit === 'PIXELS') out.push(cssVarLine(`${base}-letter-spacing`, `${value}px`));
    else if (unit === 'PERCENT') out.push(cssVarLine(`${base}-letter-spacing`, `${value / 100}em`));
  }

  return out;
}

async function syncStylesToCssLines() {
  // Styles API: /v1/files/:key/styles
  // Then node details for each style's node_id via /v1/files/:key/nodes
  const data = await figmaGetJson(`files/${FILE_KEY}/styles`);
  const styles = data?.meta?.styles ?? [];

  const ids = styles.map(s => s.node_id).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));

  const rootLines = [];

  for (const chunk of chunks) {
    const nodesRes = await figmaGetNodes(chunk);
    const nodes = nodesRes?.nodes ?? {};

    for (const st of styles) {
      if (!st?.node_id || !chunk.includes(st.node_id)) continue;
      const nodeDoc = nodes?.[st.node_id]?.document;
      if (!nodeDoc) continue;

      if (st.style_type === 'FILL') {
        const solid = takeFirstSolidPaint(nodeDoc.fills);
        if (!solid) continue;
        rootLines.push(...styleToColorVars(st.name, solid.color));
      } else if (st.style_type === 'TEXT') {
        // Text style is usually in nodeDoc.style
        rootLines.push(...styleToTextVars(st.name, nodeDoc.style));
      }
    }
  }

  // Dedup + sort
  const unique = Array.from(new Set(rootLines)).sort();
  return { meta: { stylesCount: styles.length, emittedRoot: unique.length }, lines: { rootLines: unique, darkLines: [] } };
}

function parseJsonFromText(text) {
  // strict JSON only (no trailing commas, no comments)
  return JSON.parse(text);
}

async function extractAtTokensJsonLines() {
  // Find a node (frame/component) named exactly "@tokens" (case sensitive)
  const file = await figmaGetJson(`files/${FILE_KEY}`);
  const doc = file?.document;
  if (!doc) throw new Error('No document in Figma file response.');

  let tokensNodeId = null;
  walk(doc, (n) => {
    if (tokensNodeId) return;
    if ((n?.type === 'FRAME' || n?.type === 'COMPONENT' || n?.type === 'COMPONENT_SET') && n?.name === '@tokens') {
      tokensNodeId = n.id;
    }
  });

  if (!tokensNodeId) return { meta: { found: false }, lines: [] };

  const nodeRes = await figmaGetNodes([tokensNodeId]);
  const nodeDoc = nodeRes?.nodes?.[tokensNodeId]?.document;
  if (!nodeDoc) return { meta: { found: false }, lines: [] };

  const textLayers = [];
  walk(nodeDoc, (n) => {
    if (n?.type === 'TEXT' && typeof n?.characters === 'string' && n.characters.trim()) {
      textLayers.push(n.characters.trim());
    }
  });

  if (!textLayers.length) return { meta: { found: true, parsed: false, reason: 'no-text-layer' }, lines: [] };

  // If multiple text layers exist, concatenate with newlines.
  const text = textLayers.join('\n');
  let obj;
  try {
    obj = parseJsonFromText(text);
  } catch (e) {
    return { meta: { found: true, parsed: false, reason: 'invalid-json' }, lines: [] };
  }

  // Accept {"a": "b"} flat map; values become raw CSS values.
  const lines = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    const varName = sanitizeCssVarName(String(k));
    if (!varName) continue;
    lines.push(cssVarLine(varName, String(v)));
  }
  lines.sort();

  return { meta: { found: true, parsed: true, emitted: lines.length }, lines };
}

async function writeTokensCss({ variables, styles, atTokens }) {
  const root = [];
  const dark = [];

  // Base order: variables -> styles -> @tokens (override)
  if (variables?.lines?.rootLines?.length) root.push(...variables.lines.rootLines);
  if (styles?.lines?.rootLines?.length) root.push(...styles.lines.rootLines);
  if (atTokens?.lines?.length) root.push(...atTokens.lines);

  // Dedup keeping last definition (override). We'll do this by walking forward and storing index.
  const map = new Map();
  for (const line of root) {
    const m = line.match(/^\s*--([a-z0-9\-_]+):/);
    if (!m) continue;
    map.set(m[1], line);
  }
  const mergedRoot = Array.from(map.values()).sort();

  const css = [
    '/* AUTO-GENERATED by scripts/figma-sync.mjs */',
    `/* Source: https://www.figma.com/file/${FILE_KEY} */`,
    '/* Do not edit by hand; edit Figma Styles / @tokens frame instead. */',
    '/* Priority: Variables (if available) < Styles < @tokens(JSON override) */',
    '',
    ':root {',
    ...(mergedRoot.length ? mergedRoot : ['  /* placeholder until first sync */']),
    '}',
    '',
    ...(dark.length ? ['[data-theme="dark"] {', ...dark, '}', ''] : []),
  ].join('\n');

  await fs.mkdir(path.dirname(outTokensCss), { recursive: true });
  await fs.writeFile(outTokensCss, css, 'utf8');

  return { emittedRoot: mergedRoot.length };
}

function walk(node, fn) {
  fn(node);
  const kids = node?.children ?? [];
  for (const k of kids) walk(k, fn);
}

function toSlugClass(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function scaffoldExportFrames() {
  // Basic: find frames whose name starts with EXPORT_PREFIX and generate EJS skeleton.
  const file = await figmaGetJson(`files/${FILE_KEY}`);
  const doc = file?.document;
  if (!doc) throw new Error('No document in Figma file response.');

  const exports = [];
  walk(doc, (n) => {
    const name = n?.name ?? '';
    const isExport = name.startsWith(EXPORT_PREFIX) || name.startsWith(EXPORT_PREFIX_ALT);
    if ((n?.type === 'FRAME' || n?.type === 'COMPONENT' || n?.type === 'COMPONENT_SET') && isExport) {
      exports.push({
        id: n.id,
        name,
        cleanName: (name.startsWith(EXPORT_PREFIX)
          ? name.slice(EXPORT_PREFIX.length)
          : name.slice(EXPORT_PREFIX_ALT.length)
        ).trim(),
        type: n.type,
      });
    }
  });

  exports.sort((a, b) => a.cleanName.localeCompare(b.cleanName));

  const lines = [
    '<% /* AUTO-GENERATED by scripts/figma-sync.mjs */ %>',
    `<% /* Source: https://www.figma.com/file/${FILE_KEY} */ %>`,
    `<% /* Convention: export frames/components whose name starts with "${EXPORT_PREFIX}" (or "${EXPORT_PREFIX_ALT}") */ %>`,
    '',
  ];

  if (!exports.length) {
    lines.push('<% /* No exportable frames found. Create a FRAME named "@export Home" etc. */ %>');
  } else {
    for (const ex of exports) {
      const cls = toSlugClass(ex.cleanName) || 'section';
      lines.push(`<!-- ${ex.type}: ${ex.cleanName} (nodeId: ${ex.id}) -->`);
      lines.push(`<section class="figma-section ${cls}">`);
      lines.push(`  <!-- TODO: style/layout generated later. For now this is a stable hook. -->`);
      lines.push(`</section>`);
      lines.push('');
    }
  }

  await fs.mkdir(path.dirname(outSectionsEjs), { recursive: true });
  await fs.writeFile(outSectionsEjs, lines.join('\n'), 'utf8');

  return { exported: exports.length };
}

async function main() {
  let variablesResult = { skipped: true, reason: 'not-run' };
  let stylesResult = { skipped: true, reason: 'not-run' };
  let atTokensResult = { skipped: true, reason: 'not-run' };

  // 1) Try Variables (best case) but skip if not available
  try {
    variablesResult = await syncVariablesToCssLines();
  } catch (err) {
    const msg = String(err?.message || err);

    // Common case: token doesn't have Variables scope in this workspace/account.
    if (msg.includes('requires the file_variables:read scope') || msg.includes('/variables/local')) {
      console.warn('[figma-sync] Variables sync skipped:', msg.split('\n')[0]);
      variablesResult = { skipped: true, reason: 'missing-file_variables-scope' };
    } else {
      throw err;
    }
  }

  // 2) Styles fallback
  try {
    stylesResult = await syncStylesToCssLines();
  } catch (err) {
    console.warn('[figma-sync] Styles sync skipped:', String(err?.message || err).split('\n')[0]);
    stylesResult = { skipped: true, reason: 'styles-api-error' };
  }

  // 3) @tokens JSON override
  try {
    atTokensResult = await extractAtTokensJsonLines();
  } catch (err) {
    console.warn('[figma-sync] @tokens parse skipped:', String(err?.message || err).split('\n')[0]);
    atTokensResult = { skipped: true, reason: 'tokens-parse-error' };
  }

  const tokensWrite = await writeTokensCss({
    variables: variablesResult?.lines ? variablesResult : null,
    styles: stylesResult?.lines ? stylesResult : null,
    atTokens: atTokensResult?.lines ? atTokensResult : null,
  });

  const scaffoldResult = await scaffoldExportFrames();

  console.log(JSON.stringify({
    ok: true,
    fileKey: FILE_KEY,
    tokens: {
      variables: variablesResult?.meta ?? variablesResult,
      styles: stylesResult?.meta ?? stylesResult,
      atTokens: atTokensResult?.meta ?? atTokensResult,
      written: tokensWrite,
    },
    sections: scaffoldResult,
  }, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
