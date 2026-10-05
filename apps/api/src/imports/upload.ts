import { DomainError } from '@hato/shared';
import type {} from '@fastify/multipart'; // tipos de request.parts() y request.isMultipart()
import type { FastifyRequest } from 'fastify';

import type { UploadedFile } from './spreadsheet-reader.js';

/**
 * Lee un formulario `multipart/form-data` con **un** archivo (campo `file`) y campos de texto
 * cortos. Los límites de tamaño y de partes los pone `@fastify/multipart` al registrarse
 * (`config/security.ts`); aquí se traducen sus errores al catálogo del proyecto.
 */
export async function readUpload(
  request: FastifyRequest,
): Promise<{ file: UploadedFile; fields: Record<string, string> }> {
  if (!request.isMultipart()) {
    throw new DomainError('IMPORT_FILE_INVALID', { detail: 'Sube el archivo en el campo «file».' });
  }
  let file: UploadedFile | undefined;
  const fields: Record<string, string> = {};
  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file' || file !== undefined) {
          throw new DomainError('IMPORT_FILE_INVALID', { detail: 'Sube un solo archivo.' });
        }
        file = { fileName: part.filename, mimeType: part.mimetype, data: await part.toBuffer() };
      } else if (part.valueTruncated) {
        throw new DomainError('IMPORT_FILE_INVALID', {
          detail: 'Un campo del formulario es demasiado largo.',
        });
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    const code = (error as { code?: unknown }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') throw new DomainError('IMPORT_FILE_TOO_LARGE');
    if (typeof code === 'string' && code.startsWith('FST_')) {
      throw new DomainError('IMPORT_FILE_INVALID', {
        detail: 'El formulario del archivo no es válido.',
      });
    }
    throw error;
  }
  if (file === undefined) {
    throw new DomainError('IMPORT_FILE_INVALID', { detail: 'Sube el archivo en el campo «file».' });
  }
  return { file, fields };
}
