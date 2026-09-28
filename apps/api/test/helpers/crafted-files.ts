import { crc32, deflateRawSync } from 'node:zlib';

/**
 * Archivos armados a propósito para probar las defensas de la importación (ADR-011): ZIP con
 * nombres que salen de la carpeta, bombas de descompresión, entradas cifradas o con el tamaño
 * declarado falso. Nada de esto sale de las pruebas.
 */

export type CraftedEntry = {
  readonly name: string;
  readonly data: Buffer | string;
  /** `deflate` por defecto. */
  readonly method?: 'store' | 'deflate';
  /** Bits de la cabecera; `0x0001` = cifrada. */
  readonly flags?: number;
  /** Tamaño descomprimido que se **declara** (por defecto, el real). */
  readonly declaredSize?: number;
};

/** Arma un ZIP con las entradas tal cual se piden, aunque sean inválidas. */
export function craftZip(entries: readonly CraftedEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
    const method = entry.method === 'store' ? 0 : 8;
    const body = method === 0 ? raw : deflateRawSync(raw);
    const name = Buffer.from(entry.name, 'utf8');
    const size = entry.declaredSize ?? raw.length;
    const header = (central: boolean): Buffer => {
      const buffer = Buffer.alloc(central ? 46 : 30);
      const base = central ? 2 : 0;
      buffer.writeUInt32LE(central ? 0x02014b50 : 0x04034b50, 0);
      buffer.writeUInt16LE(20, 4);
      if (central) buffer.writeUInt16LE(20, 6);
      buffer.writeUInt16LE(entry.flags ?? 0, 6 + base);
      buffer.writeUInt16LE(method, 8 + base);
      buffer.writeUInt32LE(crc32(raw), 14 + base);
      buffer.writeUInt32LE(body.length, 18 + base);
      buffer.writeUInt32LE(size, 22 + base);
      buffer.writeUInt16LE(name.length, 26 + base);
      if (central) buffer.writeUInt32LE(offset, 42);
      return buffer;
    };
    locals.push(header(false), name, body);
    centrals.push(header(true), name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** Bomba ZIP pequeña: `megabytes` de ceros comprimidos en pocos kilobytes, con tamaño falso. */
export function zipBomb(megabytes: number): Buffer {
  return craftZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: Buffer.alloc(megabytes * 1024 * 1024),
      declaredSize: 10,
    },
  ]);
}

/** Texto en Windows-1252 (lo que guarda Excel en Windows al elegir «CSV»). */
export function windows1252(text: string): Buffer {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0x3f;
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}
