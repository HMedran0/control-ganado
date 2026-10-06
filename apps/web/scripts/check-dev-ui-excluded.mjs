/**
 * Comprueba que la muestra de componentes (`/dev/ui`) no quedó en el paquete de producción.
 *
 * `routes/dev.ui.tsx` solo importa la muestra cuando `import.meta.env.DEV` es verdadero; en
 * `vite build` esa rama se elimina. Si alguien la importa desde otro lado, el texto aparece en
 * `dist/` y el build falla aquí en lugar de publicar una página interna.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
// Textos que solo existen en src/dev/UiShowcase.tsx.
const MARKERS = ['Muestra de componentes', 'Arreo · solo en desarrollo'];

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (/\.(js|html|css)$/.test(entry.name)) yield path;
  }
}

const found = [];
for await (const file of files(dist)) {
  const content = await readFile(file, 'utf8');
  for (const marker of MARKERS) if (content.includes(marker)) found.push(`${file}: «${marker}»`);
}

if (found.length > 0) {
  process.stderr.write(
    `La muestra de componentes (/dev/ui) quedó en el paquete de producción:\n${found.join('\n')}\n`,
  );
  process.exit(1);
}
process.stdout.write('La muestra de componentes (/dev/ui) no está en el paquete de producción.\n');
