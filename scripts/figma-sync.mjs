#!/usr/bin/env node
/**
 * Figma -> repo sync (tokens + scaffolds)
 *
 * Env:
 *  - FIGMA_key: Figma Personal Access Token (set as GitHub Actions secret)
 *  - FIGMA_FILE_KEY: Figma file key (e.g. AbCdEf123...)
 * Optional:
 *  - FIGMA_EXPORT_PREFIX: Only export frames/sections whose name starts with this prefix (default: "@export ")
 *
 * Outputs:
 *  - public/styles/tokens.css
 *  - views/partials/generated/figma-sections.ejs (legacy scaffold)
 *  - views/partials/generated/figma-pages/*.ejs (page scaffolds)
 *  - views/partials/generated/figma-pages/manifest.json (page -> partial map)
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
const viewsDir = path.join(ROOT, 'views');
const outTokensCss = path.join(ROOT, 'public', 'styles', 'tokens.css');
const outSectionsEjs = path.join(ROOT, 'views', 'partials', 'generated', 'figma-sections.ejs');
const outPagesDir = path.join(ROOT, 'views', 'partials', 'generated', 'figma-pages');
const outPagesManifest = path.join(outPagesDir, 'manifest.json');

async function figmaGetJson(urlPath, opts = {}) {
  const maxRetries = Number(process.env.FIGMA_API_MAX_RETRIES || 4);
  const retryBaseMs = Number(process.env.FIGMA_API_RETRY_BASE_MS || 800);
  const requestTimeoutMs = Number(process.env.FIGMA_API_TIMEOUT_MS || 30000);
  const method = opts.method || 'GET';

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    let res;
    let text = '';
    try {
      res = await fetch(`https://api.figma.com/v1/${urlPath}`, {
        method,
        headers: {
          'X-Figma-Token': FIGMA_TOKEN,
          ...(opts.headers || {}),
        },
        body: opts.body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
    } catch (err) {
      clearTimeout(timeout);
      const isAbort = err?.name === 'AbortError';
      if (attempt < maxRetries) {
        const jitter = Math.floor(Math.random() * 250);
        const waitMs = retryBaseMs * (2 ** attempt) + jitter;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      throw new Error(isAbort
        ? `Figma API timeout after ${requestTimeoutMs}ms for ${urlPath}`
        : `Figma API network error for ${urlPath}: ${err?.message || String(err)}`);
    }

    if (res.ok) return res.json();

    text = await res.text().catch(() => '');
    const isRateLimited = res.status === 429;
    const isServerError = res.status >= 500 && res.status < 600;

    if ((isRateLimited || isServerError) && attempt < maxRetries) {
      const retryAfterHeader = Number(res.headers.get('retry-after'));
      const retryAfterMs = Number.isFinite(retryAfterHeader) ? retryAfterHeader * 1000 : 0;
      const jitter = Math.floor(Math.random() * 250);
      const expBackoff = retryBaseMs * (2 ** attempt);
      const waitMs = Math.max(retryAfterMs, expBackoff + jitter);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    throw new Error(`Figma API ${res.status} ${res.statusText} for ${urlPath}\n${text}`);
  }

  throw new Error(`Figma API failed for ${urlPath}`);
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

function guessUnit(_value, name) {
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
    const modes = (col.modes ?? []).map((m) => ({ modeId: m.modeId, name: m.name }));
    collectionModes.set(col.id, { name: col.name, modes });
  }

  // Heuristic: if any mode name contains "dark" => treat it as dark.
  // Otherwise, values land in :root.
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
      } else if (val.type === 'VARIABLE_ALIAS' && val.id && variables[val.id]) {
        cssValue = `var(--${sanitizeCssVarName(variables[val.id].name)})`;
      } else {
        continue;
      }

      const line = cssVarLine(cssName, cssValue);
      const modeLower = (modeName ?? '').toLowerCase();
      if (modeLower.includes('dark')) darkLines.push(line);
      else rootLines.push(line);
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

function normalizeViewKey(viewName) {
  return String(viewName ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\.ejs$/i, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function toPartialName(viewKey) {
  const safe = normalizeViewKey(viewKey)
    .replace(/\//g, '--')
    .replace(/[^a-z0-9\-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return safe || 'page';
}

function isRenderableView(relPath) {
  const key = normalizeViewKey(relPath);
  if (!key) return false;
  if (key === 'layout' || key.endsWith('/layout')) return false;
  if (key.startsWith('layouts/')) return false;
  if (key.startsWith('partials/')) return false;
  if (key.startsWith('admin/partials/')) return false;
  return true;
}

async function listRenderableViewKeys(dir, rel = '') {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const keys = [];

  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    const absPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      keys.push(...await listRenderableViewKeys(absPath, relPath));
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.ejs')) continue;
    if (!isRenderableView(relPath)) continue;
    keys.push(normalizeViewKey(relPath));
  }

  return keys;
}

function resolveExportTargets(cleanName, knownViewKeys) {
  const raw = String(cleanName ?? '').trim();
  if (!raw) return [];

  const segments = raw.split('/').map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return [];

  let pageKey = null;
  let consumed = 0;

  for (let i = segments.length; i >= 1; i -= 1) {
    const candidate = normalizeViewKey(segments.slice(0, i).join('/'));
    if (knownViewKeys.has(candidate)) {
      pageKey = candidate;
      consumed = i;
      break;
    }
  }

  if (pageKey) {
    const sectionName = segments.slice(consumed).join('/') || 'section';
    return [{ pageKey, sectionName }];
  }

  const aliasMap = new Map([
    ['home', ['company/index', 'shop/index', 'admin/dashboard']],
    ['company/home', ['company/index']],
    ['shop/home', ['shop/index']],
    ['admin/home', ['admin/dashboard']],
  ]);

  const aliasTargets = aliasMap.get(normalizeViewKey(segments[0])) || [];
  if (!aliasTargets.length) return [];

  const filteredTargets = aliasTargets.filter((target) => knownViewKeys.has(target));
  if (!filteredTargets.length) return [];

  const sectionName = segments.slice(1).join('/') || 'section';
  return filteredTargets.map((target) => ({ pageKey: target, sectionName }));
}

async function writePagePartials(exportsList) {
  const viewKeys = Array.from(new Set(await listRenderableViewKeys(viewsDir))).sort((a, b) => a.localeCompare(b));
  const knownViewKeys = new Set(viewKeys);

  const pageSections = new Map(viewKeys.map((key) => [key, []]));

  for (const ex of exportsList) {
    const targets = resolveExportTargets(ex.cleanName, knownViewKeys);
    if (!targets.length) continue;

    for (const target of targets) {
      const bucket = pageSections.get(target.pageKey);
      if (!bucket) continue;

      bucket.push({
        id: ex.id,
        type: ex.type,
        cleanName: ex.cleanName,
        sectionName: target.sectionName,
      });
    }
  }

  await fs.mkdir(outPagesDir, { recursive: true });

  const expectedPartials = new Set();
  const pagesManifest = {};
  let pagesWithExports = 0;

  for (const viewKey of viewKeys) {
    const partialName = toPartialName(viewKey);
    const partialFile = `${partialName}.ejs`;
    expectedPartials.add(partialFile);

    const sections = (pageSections.get(viewKey) ?? []).sort((a, b) => {
      const byName = a.sectionName.localeCompare(b.sectionName);
      if (byName !== 0) return byName;
      return String(a.id).localeCompare(String(b.id));
    });

    if (sections.length) pagesWithExports += 1;

    const lines = [
      '<% /* AUTO-GENERATED by scripts/figma-sync.mjs */ %>',
      `<% /* Source: https://www.figma.com/file/${FILE_KEY} */ %>`,
      `<% /* View key: ${viewKey} */ %>`,
      `<% /* Convention: @export ${viewKey}/SectionName */ %>`,
      '',
    ];

    if (!sections.length) {
      lines.push('<% /* No exportable sections for this page yet. */ %>');
    } else {
      lines.push(`<div class="figma-page figma-page-${toSlugClass(viewKey)}" data-figma-page="${viewKey}">`);
      lines.push('');

      for (const section of sections) {
        const cls = toSlugClass(section.sectionName) || 'section';
        lines.push(`  <!-- ${section.type}: ${section.sectionName} (nodeId: ${section.id}) -->`);
        lines.push(`  <section class="figma-section ${cls}" data-figma-node-id="${section.id}">`);
        lines.push(`    <!-- Synced from Figma frame "${section.cleanName}" -->`);
        lines.push('  </section>');
        lines.push('');
      }

      lines.push('</div>');
    }

    await fs.writeFile(path.join(outPagesDir, partialFile), lines.join('\n'), 'utf8');

    pagesManifest[viewKey] = {
      partial: partialName,
      hasExports: sections.length > 0,
      sectionCount: sections.length,
      sectionNames: sections.map((s) => s.sectionName),
    };
  }

  const existingFiles = await fs.readdir(outPagesDir).catch(() => []);
  for (const f of existingFiles) {
    if (!f.toLowerCase().endsWith('.ejs')) continue;
    if (expectedPartials.has(f)) continue;
    await fs.unlink(path.join(outPagesDir, f)).catch(() => {});
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    fileKey: FILE_KEY,
    pages: pagesManifest,
  };
  await fs.writeFile(outPagesManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    totalPages: viewKeys.length,
    pagesWithExports,
    outDir: path.relative(ROOT, outPagesDir).replace(/\\/g, '/'),
  };
}

async function scaffoldExportFrames() {
  // Find frames/components whose name starts with EXPORT_PREFIX and generate EJS scaffolds.
  const file = await figmaGetJson(`files/${FILE_KEY}`);
  const doc = file?.document;
  if (!doc) throw new Error('No document in Figma file response.');

  const exportsList = [];
  walk(doc, (n) => {
    const name = n?.name ?? '';
    const isExport = name.startsWith(EXPORT_PREFIX) || name.startsWith(EXPORT_PREFIX_ALT);
    if ((n?.type === 'FRAME' || n?.type === 'COMPONENT' || n?.type === 'COMPONENT_SET') && isExport) {
      exportsList.push({
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

  exportsList.sort((a, b) => a.cleanName.localeCompare(b.cleanName));

  // Backward-compatible single scaffold file.
  const lines = [
    '<% /* AUTO-GENERATED by scripts/figma-sync.mjs */ %>',
    `<% /* Source: https://www.figma.com/file/${FILE_KEY} */ %>`,
    `<% /* Convention: export frames/components whose name starts with "${EXPORT_PREFIX}" (or "${EXPORT_PREFIX_ALT}") */ %>`,
    '',
  ];

  if (!exportsList.length) {
    lines.push('<% /* No exportable frames found. Create a FRAME named "@export Home" etc. */ %>');
  } else {
    for (const ex of exportsList) {
      const cls = toSlugClass(ex.cleanName) || 'section';
      lines.push(`<!-- ${ex.type}: ${ex.cleanName} (nodeId: ${ex.id}) -->`);
      lines.push(`<section class="figma-section ${cls}">`);
      lines.push('  <!-- TODO: style/layout generated later. For now this is a stable hook. -->');
      lines.push('</section>');
      lines.push('');
    }
  }

  await fs.mkdir(path.dirname(outSectionsEjs), { recursive: true });
  await fs.writeFile(outSectionsEjs, lines.join('\n'), 'utf8');

  const pagesResult = await writePagePartials(exportsList);
  return { exported: exportsList.length, ...pagesResult };
}

async function main() {
  let tokensResult = { skipped: true, reason: 'not-run' };

  try {
    tokensResult = await syncVariablesToCss();
  } catch (err) {
    const msg = String(err?.message || err);

    // Common case: token does not have Variables scope in this workspace/account.
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
