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
const EXPORT_PREFIX = process.env.FIGMA_EXPORT_PREFIX ?? '@export ';

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

async function figmaGetJson(urlPath) {
  const res = await fetch(`https://api.figma.com/v1/${urlPath}`, {
    headers: { 'X-Figma-Token': FIGMA_TOKEN },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Figma API ${res.status} ${res.statusText} for ${urlPath}\n${text}`);
  }
  return res.json();
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

async function syncVariablesToCss() {
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

  const css = [
    '/* AUTO-GENERATED by scripts/figma-sync.mjs */',
    `/* Source: https://www.figma.com/file/${FILE_KEY} */`,
    '/* Do not edit by hand; edit Figma Variables instead. */',
    '',
    ':root {',
    ...rootLines,
    '}',
    '',
    ...(darkLines.length
      ? ['[data-theme="dark"] {', ...darkLines, '}', '']
      : []),
  ].join('\n');

  await fs.mkdir(path.dirname(outTokensCss), { recursive: true });
  await fs.writeFile(outTokensCss, css, 'utf8');
  return { variablesCount: Object.keys(variables).length, emittedRoot: rootLines.length, emittedDark: darkLines.length };
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
    if ((n?.type === 'FRAME' || n?.type === 'COMPONENT' || n?.type === 'COMPONENT_SET') && name.startsWith(EXPORT_PREFIX)) {
      exports.push({
        id: n.id,
        name,
        cleanName: name.slice(EXPORT_PREFIX.length).trim(),
        type: n.type,
      });
    }
  });

  exports.sort((a, b) => a.cleanName.localeCompare(b.cleanName));

  const lines = [
    '<% /* AUTO-GENERATED by scripts/figma-sync.mjs */ %>',
    `<% /* Source: https://www.figma.com/file/${FILE_KEY} */ %>`,
    `<% /* Convention: export frames/components whose name starts with "${EXPORT_PREFIX}" */ %>`,
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
  let tokensResult = { skipped: true, reason: 'not-run' };

  try {
    tokensResult = await syncVariablesToCss();
  } catch (err) {
    const msg = String(err?.message || err);

    // Common case: token doesn't have Variables scope in this workspace/account.
    if (msg.includes('requires the file_variables:read scope') || msg.includes('/variables/local')) {
      console.warn('[figma-sync] Variables sync skipped:', msg.split('\n')[0]);
      // Do NOT fail the whole workflow. Keep existing tokens.css as-is.
      tokensResult = { skipped: true, reason: 'missing-file_variables-scope' };
    } else {
      throw err;
    }
  }

  const scaffoldResult = await scaffoldExportFrames();

  console.log(JSON.stringify({
    ok: true,
    fileKey: FILE_KEY,
    tokens: tokensResult,
    sections: scaffoldResult,
  }, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
