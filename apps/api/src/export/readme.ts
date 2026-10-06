import type { ExportSheet } from './export-sheets.js';
import type { ZipTimestamp } from './zip-writer.js';

/** Un archivo que quedó en el ZIP y sus filas (sin contar el encabezado). */
export type ExportedFile = { readonly file: string; readonly rows: number };

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const pad = (value: number) => String(value).padStart(2, '0');

/**
 * El `LEEME.txt` de la exportación completa (BAK-02, ADR-018): qué es cada archivo, cuántas filas
 * trae y qué significa cada columna, en español. Sale de las mismas definiciones que los Excel
 * (`EXPORT_SHEETS`), así que no se desactualiza.
 *
 * UTF-8 con BOM y saltos de línea de Windows (CRLF): así el Bloc de notas lo muestra con tildes y
 * eñes, y cualquier otro editor también.
 */
export function buildReadme(input: {
  readonly farmName: string;
  readonly generatedAt: ZipTimestamp;
  readonly sheets: readonly ExportSheet<unknown>[];
  readonly files: readonly ExportedFile[];
}): Buffer {
  const at = input.generatedAt;
  const when = `${pad(at.day)}/${pad(at.month)}/${at.year} a las ${pad(at.hour)}:${pad(at.minute)}`;
  const lines: string[] = [
    `ARREO — EXPORTACIÓN COMPLETA DE LA FINCA «${input.farmName}»`,
    `Generada el ${when} (hora de Colombia).`,
    '',
    'Este archivo comprimido trae todos los datos de la finca, uno por cada tipo de registro, para',
    'que tengas tu historia completa sin depender de Arreo: animales, identificadores, preñeces y',
    'partos, vacunas, tratamientos, pesos, gastos, ventas, catálogos, usuarios y auditoría.',
    '',
    'CÓMO LEERLOS',
    '- Cada archivo .xlsx se abre con Excel, LibreOffice o Google Sheets. La primera fila trae los',
    '  nombres de las columnas.',
    '- Las fechas van como dd/mm/aaaa y las horas en hora de Colombia.',
    '- Los valores en dinero están en pesos colombianos.',
    '- «Sí» y «No» indican si algo aplica (por ejemplo, «Anulado: Sí»).',
    '- Cada fila tiene un «Id» único. Cuando un archivo menciona otro registro, trae su nombre o',
    '  código para leerlo y también su Id para relacionarlo sin dudas (por ejemplo, el «Id del',
    '  animal» de pesajes.xlsx es el «Id» de animales.xlsx).',
    '- Nada se borra en Arreo: lo archivado y lo anulado está aquí, marcado como tal, con la fecha',
    '  y el motivo.',
    '- La edad, la categoría (Ternero, Novilla, Vaca…), las etiquetas como Preñada u Horra, el',
    '  número de partos y la inversión no se guardan: Arreo los calcula con estos datos.',
    '- Los textos que empiezan por =, +, - o @ llevan un apóstrofo delante para que la hoja de',
    '  cálculo no los tome como fórmulas.',
    '- No trae contraseñas, sesiones ni intentos de inicio de sesión.',
    '',
    'ARCHIVOS',
  ];
  for (const sheet of input.sheets) {
    const files = input.files.filter(
      (item) => item.file === sheet.file || isAuditPart(sheet.file, item.file),
    );
    const rows = files.reduce((sum, item) => sum + item.rows, 0);
    lines.push(
      '',
      `${files.map((item) => item.file).join(', ') || sheet.file} — ${sheet.title} (${rows.toLocaleString('es-CO')} ${rows === 1 ? 'fila' : 'filas'})`,
      wrap(sheet.description, ''),
      'Columnas:',
      ...sheet.columns.map((column) => wrap(`${column.header}: ${column.description}`, '  - ')),
    );
  }
  lines.push('');
  return Buffer.concat([BOM, Buffer.from(lines.join('\r\n'), 'utf8')]);
}

function isAuditPart(sheetFile: string, file: string): boolean {
  return sheetFile === 'auditoria.xlsx' && /^auditoria-\d+\.xlsx$/.test(file);
}

/** Corta en líneas de hasta 96 caracteres, con sangría francesa después de la primera. */
function wrap(text: string, prefix: string): string {
  const indent = ' '.repeat(prefix.length);
  const lines: string[] = [];
  let line = prefix;
  for (const word of text.split(' ')) {
    const base = lines.length === 0 ? prefix : indent;
    if (line.length > base.length && line.length + 1 + word.length > 96) {
      lines.push(line);
      line = indent + word;
    } else {
      line = line.length === base.length ? line + word : `${line} ${word}`;
    }
  }
  lines.push(line);
  return lines.join('\r\n');
}
