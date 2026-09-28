import { RFID_LENGTH, type SearchMatch, type SearchResult } from '@hato/shared';

/**
 * Qué hacer con el resultado de una búsqueda (ANI-05, IDN-02 CA2). Es una decisión pura, aparte
 * de la navegación, para poder probarla sin pantalla.
 */
export type SearchOutcome =
  /** Coincidencia exacta con un solo animal: se abre su ficha. */
  | {
      readonly kind: 'open';
      readonly animalId: string;
      /** Si coincidió por un identificador retirado, cuál («Identificador anterior»). */
      readonly previous: { readonly type: string; readonly value: string } | null;
    }
  /** Varias coincidencias, difusas o ninguna: la pantalla de resultados. */
  | { readonly kind: 'results' };

export function searchOutcome(result: SearchResult): SearchOutcome {
  const exact = result.exactMatch;
  if (exact === null) return { kind: 'results' };
  return { kind: 'open', animalId: exact.animalId, previous: previousIdentifier(exact.via) };
}

function previousIdentifier(match: SearchMatch): { type: string; value: string } | null {
  return match.kind === 'IDENTIFIER' && match.previous
    ? { type: match.identifierType, value: match.value }
    : null;
}

/** ¿El texto parece un chip ISO 11784 (15 dígitos, con o sin espacios)? */
export function looksLikeRfid(q: string): boolean {
  return new RegExp(`^\\d{${RFID_LENGTH}}$`).test(q.replace(/\s/g, ''));
}

/**
 * ¿Hay que ofrecer «Asociar a un animal» o «Registrar animal nuevo»? Cuando lo buscado parece un
 * chip y ninguna coincidencia es exacta: es un chip que la finca todavía no tiene registrado.
 */
export function offersRfidAssociation(q: string, result: SearchResult): boolean {
  return looksLikeRfid(q) && result.items.every((item) => !item.exact);
}
