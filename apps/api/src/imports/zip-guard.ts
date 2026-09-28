import { crc32, inflateRawSync } from 'node:zlib';

/**
 * Lector mínimo de ZIP para abrir un `.xlsx` sin confiar en él (ADR-011).
 *
 * Un `.xlsx` es un ZIP. `exceljs` lo abre con JSZip, que descomprime todo sin límite y no ofrece
 * cómo ponérselo: un archivo de 5 MB puede inflarse a gigabytes (bomba ZIP). Por eso, antes de
 * que `exceljs` vea nada:
 *
 * 1. se recorre el **directorio central** y se rechazan entradas cifradas, ZIP64, métodos que no
 *    sean «guardado» (0) o «deflate» (8), nombres repetidos y nombres que intentan salir de la
 *    carpeta (`../`, rutas absolutas, `\`, letras de unidad, NUL);
 * 2. se **descomprime cada entrada de verdad** con `inflateRawSync({ maxOutputLength })`, con un
 *    presupuesto total: no se cuenta con el tamaño que declara el archivo, que puede mentir, ni
 *    con que dos entradas no apunten a los mismos datos;
 * 3. se vuelve a empaquetar lo ya medido **sin compresión** (`buildStoredZip`). Eso es lo único
 *    que recibe `exceljs`: no tiene nada que inflar, así que abre exactamente lo que se midió.
 *
 * No escribe en disco: todo ocurre en memoria, así que los nombres no pueden tocar el sistema de
 * archivos; se validan igual porque un nombre así solo aparece en un archivo armado a propósito.
 */

/** Por qué se rechazó el archivo. El mensaje es para el log, no para la persona. */
export class ZipRejected extends Error {
  constructor(readonly reason: string) {
    super(`ZIP rechazado: ${reason}`);
    this.name = 'ZipRejected';
  }
}

/** Entrada ya descomprimida. */
export type ZipEntry = { readonly name: string; readonly data: Buffer };

export type ZipLimits = {
  /** Suma de los tamaños descomprimidos, en bytes. */
  readonly maxTotalBytes: number;
  /** Número de entradas. */
  readonly maxEntries: number;
};

/** Límites para una hoja de hasta 5.000 filas: holgados para ella, mínimos para una bomba. */
export const XLSX_ZIP_LIMITS: ZipLimits = { maxTotalBytes: 50 * 1024 * 1024, maxEntries: 500 };

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;
const FLAG_ENCRYPTED = 0x0001;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** ¿Empieza como un ZIP (firma de cabecera local)? */
export function looksLikeZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === LOCAL_SIGNATURE;
}

/** Nombre seguro: relativo, sin subir de carpeta, sin `\`, sin unidad y sin NUL. */
export function isSafeEntryName(name: string): boolean {
  if (name === '' || name.includes('\0') || name.includes('\\')) return false;
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false;
  return !name.split('/').some((part) => part === '..');
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const lowest = Math.max(0, buffer.length - EOCD_MIN_SIZE - MAX_COMMENT);
  for (let offset = buffer.length - EOCD_MIN_SIZE; offset >= lowest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new ZipRejected('no se encontró el final del directorio central');
}

/**
 * Lee y descomprime todas las entradas con los límites dados.
 *
 * @throws {ZipRejected} si algo no cuadra o se pasa de los límites.
 */
export function readZipEntries(buffer: Buffer, limits: ZipLimits): ZipEntry[] {
  if (!looksLikeZip(buffer)) throw new ZipRejected('no empieza con la firma de un ZIP');
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd >= 20 && buffer.readUInt32LE(eocd - 20) === ZIP64_LOCATOR_SIGNATURE) {
    throw new ZipRejected('ZIP64 no se admite');
  }
  const count = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (count === 0xffff || directoryOffset === 0xffffffff)
    throw new ZipRejected('ZIP64 no se admite');
  if (count > limits.maxEntries) throw new ZipRejected(`demasiadas entradas (${count})`);
  if (directoryOffset + directorySize > eocd) {
    throw new ZipRejected('el directorio central se sale del archivo');
  }

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let budget = limits.maxTotalBytes;
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new ZipRejected('entrada del directorio central dañada');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (!isSafeEntryName(name))
      throw new ZipRejected(`nombre de entrada inseguro: ${JSON.stringify(name)}`);
    if (names.has(name)) throw new ZipRejected(`entrada repetida: ${name}`);
    names.add(name);
    if ((flags & FLAG_ENCRYPTED) !== 0) throw new ZipRejected(`entrada cifrada: ${name}`);
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) {
      throw new ZipRejected(`método de compresión ${method} en ${name}`);
    }
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipRejected('ZIP64 no se admite');
    }
    if (name.endsWith('/')) continue; // carpeta

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new ZipRejected(`cabecera local dañada en ${name}`);
    }
    const dataStart =
      localOffset +
      30 +
      buffer.readUInt16LE(localOffset + 26) +
      buffer.readUInt16LE(localOffset + 28);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new ZipRejected(`los datos de ${name} se salen del archivo`);
    const raw = buffer.subarray(dataStart, dataEnd);

    let data: Buffer;
    if (method === METHOD_STORED) {
      data = Buffer.from(raw);
    } else {
      try {
        // `maxOutputLength` corta la descompresión apenas se pasa: el tamaño real, no el declarado.
        data = inflateRawSync(raw, { maxOutputLength: Math.max(1, budget) });
      } catch {
        throw new ZipRejected(`${name} se infla más de lo permitido o está dañado`);
      }
    }
    budget -= data.length;
    if (budget < 0) throw new ZipRejected('el contenido descomprimido supera el límite');
    entries.push({ name, data });
  }
  return entries;
}

/**
 * Arma un ZIP sin compresión con las entradas dadas. Lo recibe `exceljs`, que así no descomprime
 * nada: abre exactamente los bytes que `readZipEntries` ya midió.
 */
export function buildStoredZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4); // versión necesaria
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(METHOD_STORED, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(METHOD_STORED, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(EOCD_MIN_SIZE);
  end.writeUInt32LE(EOCD_SIGNATURE, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
