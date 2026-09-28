import { isUuid } from '../id.js';

/**
 * QR del sistema (IDN-03). Lleva solo la dirección pública de la web y la ruta corta de la ficha,
 * `${PUBLIC_WEB_URL}/a/<uuid>`: ningún dato del animal (CA3). Abrirla exige sesión, y la ficha
 * solo se muestra a quien es de la finca del animal.
 */

/** Ruta corta de la ficha que codifica el QR. */
export const QR_PATH = '/a/';

/** URL que codifica el QR de un animal. `publicWebUrl` puede venir con o sin `/` final. */
export function systemQrUrl(publicWebUrl: string, animalId: string): string {
  return `${publicWebUrl.replace(/\/+$/, '')}${QR_PATH}${animalId}`;
}

const QR_PATTERN = /(?:^|\/)a\/([0-9a-fA-F-]{36})\/?(?:[?#].*)?$/;

/**
 * Id del animal si el texto es el contenido de un QR del sistema (lo que escribe un lector de QR
 * en el buscador, ANI-05): una URL que termina en `/a/<uuid>`, o solo esa ruta. No se exige el
 * dominio: el id solo abre un animal de la finca de quien busca.
 */
export function parseSystemQr(text: string): string | null {
  const match = QR_PATTERN.exec(text.trim());
  const id = match?.[1]?.toLowerCase();
  return id !== undefined && isUuid(id) ? id : null;
}
