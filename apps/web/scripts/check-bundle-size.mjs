/**
 * Tamaño de la carga inicial de la web (RNF-02): lo que el navegador descarga antes de la
 * primera pintura, comprimido con gzip.
 *
 * La carga inicial son los archivos que `dist/index.html` pide de entrada: el script principal,
 * los `modulepreload` y las hojas de estilo. Las rutas que se cargan después (la ficha, los
 * formularios, las finanzas) no cuentan. Cada archivo se comprime con gzip nivel 9 y se suma;
 * un KB son 1.024 bytes. Las fuentes no entran: ya viajan comprimidas (woff2).
 *
 * La precarga de Inicio (M8b, `data-precarga` en `index.html`, ver `vite.config.ts`) se mide
 * aparte: baja en paralelo y no bloquea el arranque, pero gasta datos, así que tiene su propio
 * tope.
 *
 * Los topes viven en un solo lugar, `hato.initialLoadBudgetKb` y `hato.preloadBudgetKb` de
 * `apps/web/package.json`. Sirven para detectar saltos, no para frenar el crecimiento normal: si
 * hay que subirlos, el mensaje del commit explica por qué.
 *
 * Sin dependencias: size-limit no sabe qué trozos con hash forman la carga inicial y habría que
 * leer el `index.html` de todas formas.
 */
import { appendFile, readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);

const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const budgetKb = pkg.hato?.initialLoadBudgetKb;
const preloadBudgetKb = pkg.hato?.preloadBudgetKb;
if (typeof budgetKb !== 'number' || typeof preloadBudgetKb !== 'number') {
  process.stderr.write(
    'Faltan hato.initialLoadBudgetKb o hato.preloadBudgetKb en apps/web/package.json.\n',
  );
  process.exit(1);
}

let html;
try {
  html = await readFile(new URL('index.html', dist), 'utf8');
} catch {
  process.stderr.write('No existe apps/web/dist/index.html: corre primero `pnpm build`.\n');
  process.exit(1);
}

// <script type="module" src>, <link rel="modulepreload" href> y <link rel="stylesheet" href>;
// los que llevan `data-precarga` van aparte.
const tags = [...html.matchAll(/<(?:script|link)\b[^>]*>/g)].map((match) => match[0]);
const assetsOf = (preload) => [
  ...new Set(
    tags
      .filter((tag) => /\bdata-precarga\b/.test(tag) === preload)
      .map((tag) => /\b(?:src|href)="\/?([^"]+\.(?:js|css))"/.exec(tag)?.[1])
      .filter((asset) => asset !== undefined),
  ),
];
const initialAssets = assetsOf(false);
const preloadAssets = assetsOf(true);
if (initialAssets.length === 0) {
  process.stderr.write('dist/index.html no pide ningún script ni hoja de estilo.\n');
  process.exit(1);
}

async function measure(assets) {
  const rows = [];
  for (const asset of assets) {
    const content = await readFile(new URL(asset, dist));
    rows.push({ asset, gzip: gzipSync(content, { level: 9 }).length });
  }
  return rows.sort((a, b) => b.gzip - a.gzip);
}
const rows = await measure(initialAssets);
const preloadRows = await measure(preloadAssets);

const kb = (bytes) => (bytes / 1024).toFixed(1);
const sum = (list, filter = () => true) =>
  list.filter(filter).reduce((total, row) => total + row.gzip, 0);
const total = sum(rows);
const js = sum(rows, (row) => row.asset.endsWith('.js'));
const css = sum(rows, (row) => row.asset.endsWith('.css'));
const preloadTotal = sum(preloadRows);
const over = total > budgetKb * 1024;
const preloadOver = preloadTotal > preloadBudgetKb * 1024;

const lines = [
  `Carga inicial: ${kb(total)} KB gzip (JS ${kb(js)} KB + CSS ${kb(css)} KB) · tope ${budgetKb} KB`,
  ...rows.map((row) => `  ${kb(row.gzip).padStart(6)} KB  ${row.asset}`),
  `Precarga de Inicio: ${kb(preloadTotal)} KB gzip · tope ${preloadBudgetKb} KB`,
  ...preloadRows.map((row) => `  ${kb(row.gzip).padStart(6)} KB  ${row.asset}`),
];
process.stdout.write(`${lines.join('\n')}\n`);

// En GitHub Actions, también en el resumen del job.
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary !== undefined && summary !== '') {
  const table = [
    `### Carga inicial de la web: ${kb(total)} KB gzip de ${budgetKb} KB ${over ? '❌' : '✅'}`,
    '',
    `JS ${kb(js)} KB · CSS ${kb(css)} KB · ${rows.length} archivos · precarga de Inicio ` +
      `${kb(preloadTotal)} KB de ${preloadBudgetKb} KB ${preloadOver ? '❌' : '✅'}`,
    '',
    '| Archivo | gzip (KB) |',
    '|---|---:|',
    ...rows.map((row) => `| \`${row.asset}\` | ${kb(row.gzip)} |`),
    ...preloadRows.map((row) => `| \`${row.asset}\` (precarga) | ${kb(row.gzip)} |`),
    '',
  ];
  await appendFile(summary, `${table.join('\n')}\n`);
}

if (over) {
  process.stderr.write(
    `La carga inicial (${kb(total)} KB) pasa del tope de ${budgetKb} KB. Revisa qué entró al ` +
      'paquete principal; si el aumento es legítimo, sube hato.initialLoadBudgetKb y explica ' +
      'por qué en el commit.\n',
  );
}
if (preloadOver) {
  process.stderr.write(
    `La precarga de Inicio (${kb(preloadTotal)} KB) pasa del tope de ${preloadBudgetKb} KB. ` +
      'Revisa qué entró a los chunks app-shell e inicio (vite.config.ts); si el aumento es ' +
      'legítimo, sube hato.preloadBudgetKb y explica por qué en el commit.\n',
  );
}
if (over || preloadOver) process.exit(1);
