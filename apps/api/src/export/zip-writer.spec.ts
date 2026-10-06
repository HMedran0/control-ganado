import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import { afterAll, describe, expect, it } from 'vitest';

import { readZipEntries } from '../imports/zip-guard.js';
import { ZipWriter, type ZipTimestamp } from './zip-writer.js';

/**
 * El ZIP de la exportación completa (BAK-02, ADR-018) se abre con el lector propio de la
 * importación (`zip-guard`), con `unzip -t` de Info-ZIP y con `zipfile` de Python: los tres
 * lectores más estrictos que hay a mano, además del explorador de Windows que no se puede
 * automatizar aquí. En la integración continua `unzip` y `python3` están siempre; en local, si
 * falta alguno, esa prueba se omite con un aviso.
 */

const CI = process.env.CI !== undefined;
const STAMP: ZipTimestamp = { year: 2026, month: 10, day: 6, hour: 14, minute: 37, second: 22 };
const LIMITS = { maxTotalBytes: 100 * 1024 * 1024, maxEntries: 100 };

async function buildZip(
  build: (zip: ZipWriter) => Promise<void>,
  out = new PassThrough(),
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  out.on('data', (chunk: Buffer) => chunks.push(chunk));
  const ended = new Promise((resolve) => out.on('end', resolve));
  const zip = new ZipWriter(out, STAMP);
  await build(zip);
  await zip.finish();
  out.end();
  await ended;
  return Buffer.concat(chunks);
}

/** Un stream que entrega `data` en pedazos de `size` bytes, como lo haría exceljs. */
function chunked(data: Buffer, size: number): Readable {
  let offset = 0;
  return new Readable({
    read() {
      if (offset >= data.length) {
        this.push(null);
        return;
      }
      this.push(data.subarray(offset, offset + size));
      offset += size;
    },
  });
}

const leeme = Buffer.concat([
  Buffer.from([0xef, 0xbb, 0xbf]),
  Buffer.from('LÉEME — exportación de la finca «La Esperanza»: preñez, año, ñandú.\r\n', 'utf8'),
]);
// Medio comprimible y medio aleatorio, para que DEFLATE trabaje en varios bloques.
const big = Buffer.concat([Buffer.alloc(2 * 1024 * 1024, 'arreo;'), randomBytes(1024 * 1024)]);

describe('ZipWriter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arreo-zip-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('el lector de la importación recupera cada entrada byte a byte', async () => {
    const zip = await buildZip(async (writer) => {
      await writer.addEntry('LEEME.txt', leeme, { level: 9 });
      await writer.addEntry('animales.xlsx', chunked(big, 64 * 1024), { level: 1 });
      await writer.addEntry('vacio.xlsx', Buffer.alloc(0));
    });
    const entries = readZipEntries(zip, LIMITS);
    expect(entries.map((entry) => entry.name)).toEqual([
      'LEEME.txt',
      'animales.xlsx',
      'vacio.xlsx',
    ]);
    expect(entries[0]?.data.equals(leeme)).toBe(true);
    expect(entries[1]?.data.equals(big)).toBe(true);
    expect(entries[2]?.data.length).toBe(0);
    // Comprime de verdad: la parte repetida no viaja entera.
    expect(zip.length).toBeLessThan(big.length);
  });

  it('solo acepta nombres ASCII sin carpetas (ADR-018)', async () => {
    for (const name of ['preñez.xlsx', 'vacunación.xlsx', 'a/b.xlsx', '../x.txt', ' x.txt', '']) {
      await expect(
        buildZip((writer) => writer.addEntry(name, Buffer.from('x'))),
        name,
      ).rejects.toThrow(/Nombre de entrada no permitido/);
    }
  });

  it('falla si la descarga se corta, en lugar de quedarse esperando', async () => {
    const out = new PassThrough({ highWaterMark: 1024 });
    const zip = new ZipWriter(out, STAMP);
    const writing = zip.addEntry('animales.xlsx', chunked(randomBytes(512 * 1024), 16 * 1024));
    // Nadie lee `out`: se llena y espera `drain`; el cliente se va.
    setTimeout(() => out.destroy(), 50);
    await expect(writing).rejects.toThrow(/interrumpió/);
  });

  it('unzip -t lo da por bueno', async (context) => {
    if (!hasCommand('unzip', ['-v'])) {
      if (CI) throw new Error('La integración continua debe tener unzip.');
      context.skip();
      return;
    }
    const path = join(dir, 'unzip.zip');
    writeFileSync(
      path,
      await buildZip(async (writer) => {
        await writer.addEntry('LEEME.txt', leeme, { level: 9 });
        await writer.addEntry('pesajes.xlsx', chunked(big, 50_000), { level: 1 });
      }),
    );
    const result = spawnSync('unzip', ['-t', path], { encoding: 'utf8' });
    expect(result.stdout).toMatch(/No errors detected/);
    expect(result.status).toBe(0);
  });

  it('zipfile de Python lo abre, comprueba los CRC y ve la fecha', async (context) => {
    const python = findPython();
    if (python === null) {
      if (CI) throw new Error('La integración continua debe tener python3.');
      context.skip();
      return;
    }
    const path = join(dir, 'python.zip');
    writeFileSync(
      path,
      await buildZip(async (writer) => {
        await writer.addEntry('LEEME.txt', leeme, { level: 9 });
        await writer.addEntry('prenez-y-partos.xlsx', chunked(big, 70_000), { level: 1 });
      }),
    );
    const script = [
      'import json, sys, zipfile',
      'z = zipfile.ZipFile(sys.argv[1])',
      'bad = z.testzip()',
      'infos = [[i.filename, i.file_size, list(i.date_time)] for i in z.infolist()]',
      'text = z.read("LEEME.txt").decode("utf-8-sig")',
      'print(json.dumps({"bad": bad, "infos": infos, "text": text}))',
    ].join('\n');
    const result = spawnSync(python, ['-c', script, path], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    const parsed = JSON.parse(result.stdout) as {
      bad: string | null;
      infos: [string, number, number[]][];
      text: string;
    };
    expect(parsed.bad).toBeNull();
    expect(parsed.infos).toEqual([
      ['LEEME.txt', leeme.length, [2026, 10, 6, 14, 37, 22]],
      ['prenez-y-partos.xlsx', big.length, [2026, 10, 6, 14, 37, 22]],
    ]);
    expect(parsed.text).toContain('preñez');
  });
});

function hasCommand(command: string, args: readonly string[]): boolean {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return result.error === undefined && result.status === 0;
}

/** `python3` en Linux y macOS; `py` (el lanzador) en Windows, donde `python3` puede ser un alias. */
function findPython(): string | null {
  for (const candidate of ['python3', 'py', 'python']) {
    if (hasCommand(candidate, ['-c', 'import zipfile'])) return candidate;
  }
  return null;
}
