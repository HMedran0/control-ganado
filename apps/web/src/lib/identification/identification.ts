import { IDENTIFIED_BY, type IdentifiedBy } from '@hato/shared';

/**
 * Cómo se identificó al animal que se está trabajando (PES-01, PIL-05): por búsqueda, con el
 * lector RFID o escaneando su QR. La búsqueda lo recuerda al abrir la ficha y el formulario de
 * peso lo propone; la persona lo puede cambiar.
 *
 * Vive en `sessionStorage` del navegador, 30 minutos: es una comodidad de esta pestaña, no un dato
 * que deba sobrevivir ni viajar. Si el almacenamiento no está disponible, la respuesta es
 * «búsqueda».
 */

const PREFIX = 'hato:identificado:';
const MAX_AGE_MS = 30 * 60 * 1000;

/** Las tres formas de identificar al animal en el formulario; la importación es aparte. */
export type ManualIdentification = Exclude<IdentifiedBy, 'IMPORT'>;

type Stored = { readonly by: ManualIdentification; readonly at: number };

/** Recuerda cómo se identificó al animal. */
export function rememberIdentification(
  animalId: string,
  by: ManualIdentification,
  now = Date.now(),
): void {
  try {
    sessionStorage.setItem(
      `${PREFIX}${animalId}`,
      JSON.stringify({ by, at: now } satisfies Stored),
    );
  } catch {
    // Sin almacenamiento (ventana privada, bloqueado): el formulario propone «búsqueda».
  }
}

/** Cómo se identificó al animal en los últimos 30 minutos; si no se sabe, por búsqueda. */
export function recalledIdentification(animalId: string, now = Date.now()): ManualIdentification {
  try {
    const raw = sessionStorage.getItem(`${PREFIX}${animalId}`);
    if (raw === null) return IDENTIFIED_BY.SEARCH;
    const stored = JSON.parse(raw) as Partial<Stored>;
    const valid =
      stored.by === IDENTIFIED_BY.RFID_READER ||
      stored.by === IDENTIFIED_BY.QR ||
      stored.by === IDENTIFIED_BY.SEARCH;
    if (!valid || typeof stored.at !== 'number' || now - stored.at > MAX_AGE_MS) {
      return IDENTIFIED_BY.SEARCH;
    }
    return stored.by;
  } catch {
    return IDENTIFIED_BY.SEARCH;
  }
}
