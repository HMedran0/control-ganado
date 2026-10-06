import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { constants, crc32, createDeflateRaw } from 'node:zlib';

/**
 * Escritor de ZIP en streaming para la exportación completa (BAK-02, ADR-018), sin
 * dependencias: cada entrada se comprime con DEFLATE mientras llega y se escribe enseguida, así
 * que nada del archivo entero queda en memoria.
 *
 * Como el tamaño y el CRC de una entrada no se conocen antes de comprimirla, la cabecera local
 * los deja en cero y los trae después el «descriptor de datos» (bit 3 de las banderas); el
 * directorio central del final los repite. Es el formato que escriben `zip` de Info-ZIP y la
 * mayoría de las librerías en streaming, y lo leen el explorador de Windows, 7-Zip, `unzip` y
 * `zipfile` de Python.
 *
 * - Todas las entradas van con DEFLATE, también las `.xlsx` (que ya vienen comprimidas): DEFLATE
 *   con descriptor de datos es la combinación que entiende todo lector; STORED con descriptor no.
 * - Nombres solo en ASCII imprimible y sin carpetas: el explorador de Windows muestra mal los
 *   nombres que no son ASCII en muchos ZIP (ADR-018). Se rechaza cualquier otro.
 * - Sin ZIP64: el archivo y cada entrada deben pesar menos de 4 GiB. Una finca de 5.000 animales
 *   produce unos pocos MB; si alguna vez se acercara, el escritor falla en lugar de producir un
 *   ZIP corrupto.
 */

const LOCAL_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
/** 2.0: DEFLATE y descriptor de datos. */
const VERSION = 20;
/** Bit 3: tamaños y CRC en el descriptor de datos que sigue a la entrada. */
const FLAG_DATA_DESCRIPTOR = 0x0008;
const METHOD_DEFLATE = 8;
const MAX_32 = 0xffffffff;
const MAX_ENTRIES = 0xffff;

/** Nombre aceptado dentro del ZIP: ASCII imprimible, sin `/`, `\`, `:` ni espacios al borde. */
export const ZIP_ENTRY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Fecha y hora del reloj de la finca, para las cabeceras (formato MS-DOS, sin zona horaria). */
export type ZipTimestamp = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
};

type CentralRecord = {
  readonly name: Buffer;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly offset: number;
};

export type ZipEntryOptions = {
  /** Nivel de DEFLATE: 1 para lo que ya viene comprimido (`.xlsx`), 9 para el texto. */
  readonly level?: number;
};

export class ZipWriter {
  private offset = 0;
  private readonly records: CentralRecord[] = [];
  private readonly time: number;
  private readonly date: number;
  private finished = false;

  constructor(
    private readonly out: Writable,
    timestamp: ZipTimestamp,
  ) {
    this.time = (timestamp.hour << 11) | (timestamp.minute << 5) | Math.floor(timestamp.second / 2);
    this.date = ((timestamp.year - 1980) << 9) | (timestamp.month << 5) | timestamp.day;
  }

  /**
   * Agrega una entrada con el contenido de `source` (un `Buffer` o un stream que termina), y
   * espera a que esté escrita. Las entradas se agregan de a una.
   */
  async addEntry(
    name: string,
    source: Buffer | Readable,
    options: ZipEntryOptions = {},
  ): Promise<void> {
    if (this.finished) throw new Error('El ZIP ya se cerró.');
    if (!ZIP_ENTRY_NAME.test(name)) {
      throw new Error(`Nombre de entrada no permitido en el ZIP: ${JSON.stringify(name)}.`);
    }
    if (this.records.length >= MAX_ENTRIES) throw new Error('Demasiadas entradas para un ZIP.');
    const nameBytes = Buffer.from(name, 'ascii');
    const offset = this.offset;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAG_DATA_DESCRIPTOR, 6);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(this.time, 10);
    local.writeUInt16LE(this.date, 12);
    // CRC y tamaños (14 a 25) en cero: van en el descriptor de datos.
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    await this.write(Buffer.concat([local, nameBytes]));

    let crc = 0;
    let size = 0;
    let compressedSize = 0;
    const deflate = createDeflateRaw({ level: options.level ?? constants.Z_DEFAULT_COMPRESSION });
    const compressed = (async () => {
      for await (const chunk of deflate as AsyncIterable<Buffer>) {
        compressedSize += chunk.length;
        await this.write(chunk);
      }
    })();
    const fed = (async () => {
      const chunks: AsyncIterable<unknown> | Iterable<Buffer> = Buffer.isBuffer(source)
        ? [source]
        : source;
      for await (const raw of chunks) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
        crc = crc32(chunk, crc);
        size += chunk.length;
        if (!deflate.write(chunk)) await once(deflate, 'drain');
      }
      deflate.end();
    })();
    try {
      await Promise.all([fed, compressed]);
    } catch (error) {
      deflate.destroy();
      throw error;
    }
    if (size > MAX_32 || compressedSize > MAX_32) {
      throw new Error(`La entrada ${name} pasa de 4 GiB: el ZIP necesitaría ZIP64.`);
    }

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(DESCRIPTOR_SIGNATURE, 0);
    descriptor.writeUInt32LE(crc >>> 0, 4);
    descriptor.writeUInt32LE(compressedSize, 8);
    descriptor.writeUInt32LE(size, 12);
    await this.write(descriptor);

    this.records.push({ name: nameBytes, crc: crc >>> 0, compressedSize, size, offset });
  }

  /** Escribe el directorio central y el final del archivo. No cierra `out`. */
  async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    const start = this.offset;
    for (const record of this.records) {
      const central = Buffer.alloc(46);
      central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
      central.writeUInt16LE(VERSION, 4); // hecho por: MS-DOS, versión 2.0
      central.writeUInt16LE(VERSION, 6);
      central.writeUInt16LE(FLAG_DATA_DESCRIPTOR, 8);
      central.writeUInt16LE(METHOD_DEFLATE, 10);
      central.writeUInt16LE(this.time, 12);
      central.writeUInt16LE(this.date, 14);
      central.writeUInt32LE(record.crc, 16);
      central.writeUInt32LE(record.compressedSize, 20);
      central.writeUInt32LE(record.size, 24);
      central.writeUInt16LE(record.name.length, 28);
      // Campo extra, comentario, disco, atributos internos y externos: en cero.
      central.writeUInt32LE(record.offset, 42);
      await this.write(Buffer.concat([central, record.name]));
    }
    const size = this.offset - start;
    if (this.offset > MAX_32) throw new Error('El ZIP pasa de 4 GiB: necesitaría ZIP64.');
    const end = Buffer.alloc(22);
    end.writeUInt32LE(END_SIGNATURE, 0);
    end.writeUInt16LE(this.records.length, 8);
    end.writeUInt16LE(this.records.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(start, 16);
    await this.write(end);
  }

  /** Escribe respetando la contrapresión: si `out` está lleno, espera a que se vacíe. */
  private async write(chunk: Buffer): Promise<void> {
    this.offset += chunk.length;
    if (this.out.destroyed) throw new Error('La descarga se interrumpió.');
    if (!this.out.write(chunk)) await drained(this.out);
  }
}

/** Espera `drain`; si `out` se cierra antes (el cliente cortó la descarga), falla. */
export function drained(out: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDrain = () => {
      out.off('close', onClose);
      resolve();
    };
    const onClose = () => {
      out.off('drain', onDrain);
      reject(new Error('La descarga se interrumpió.'));
    };
    out.once('drain', onDrain);
    out.once('close', onClose);
  });
}
