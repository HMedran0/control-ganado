import { useEffect, useRef } from 'react';

/** Dígitos de un chip ISO 11784/11785 (FDX-B, HDX). */
export const RFID_DIGITS = 15;

/**
 * Intervalo máximo entre dos teclas de una lectura. Un lector Bluetooth en modo teclado envía
 * un carácter cada 10 a 30 ms; una persona, cada 100 ms o más. Ajustable cuando se pruebe con
 * el lector real de la finca.
 */
export const DEFAULT_MAX_KEY_INTERVAL_MS = 50;

/** Marca del campo que recibe lecturas como búsqueda (el SearchBar). */
export const RFID_TARGET_ATTRIBUTE = 'data-rfid-target';

/** Marca de un campo de formulario que se llena con el lector («Identificador»). */
export const RFID_FIELD_ATTRIBUTE = 'data-rfid-field';

export type RfidReaderOptions = {
  /**
   * Recibe el código leído cuando la lectura no cae en un campo de formulario: sin foco en
   * ningún campo, o con foco en el campo marcado con `data-rfid-target`. Sin esta función, el
   * hook solo protege los campos marcados con `data-rfid-field`.
   */
  readonly onRead?: (code: string) => void;
  readonly enabled?: boolean;
  readonly digits?: number;
  readonly maxKeyIntervalMs?: number;
  /**
   * Instante de cada tecla en milisegundos; las pruebas lo reemplazan. Por defecto,
   * `event.timeStamp`: cuándo el sistema generó la tecla, no cuándo la página alcanzó a
   * procesarla. Si el celular está ocupado y atiende varias teclas juntas, el ritmo que se mide
   * sigue siendo el del lector. Monotónico, no la fecha.
   */
  readonly now?: (event: KeyboardEvent) => number;
};

/**
 * Lector RFID en modo teclado (04-arquitectura.md §6, IDN-04 en F2).
 *
 * El lector «escribe» los 15 dígitos del chip y un Enter. Una lectura se reconoce así:
 * exactamente `digits` dígitos seguidos de Enter, **sin que ningún intervalo entre teclas
 * consecutivas supere `maxKeyIntervalMs`**. No se mide la duración total: a 30 ms por carácter
 * una lectura real tarda casi medio segundo, y una regla de «todo en menos de 100 ms» nunca la
 * detectaría.
 *
 * Qué pasa con la lectura según dónde esté el foco:
 * - **Ningún campo editable**: se entrega a `onRead` y el Enter se descarta.
 * - **Campo con `data-rfid-target`** (el buscador): los dígitos ya quedaron escritos; el Enter
 *   se absorbe y la lectura se entrega a `onRead`.
 * - **Campo con `data-rfid-field`** (por ejemplo «Identificador» al crear un animal): los dígitos
 *   quedan en el campo, el Enter se absorbe para que no envíe el formulario antes de tiempo y
 *   el foco pasa al siguiente campo.
 * - **Cualquier otro campo editable**: no se toca nada; la persona decide qué hace su Enter.
 */
export function useRfidReader({
  onRead,
  enabled = true,
  digits = RFID_DIGITS,
  maxKeyIntervalMs = DEFAULT_MAX_KEY_INTERVAL_MS,
  now = defaultNow,
}: RfidReaderOptions = {}): void {
  // Las opciones cambian en cada render; el listener lee siempre la última versión sin tener
  // que volver a registrarse.
  const latest = useRef({ onRead, digits, maxKeyIntervalMs, now });
  useEffect(() => {
    latest.current = { onRead, digits, maxKeyIntervalMs, now };
  });

  useEffect(() => {
    if (!enabled) return undefined;

    let buffer = '';
    let lastKeyAt = Number.NEGATIVE_INFINITY;

    const reset = (): void => {
      buffer = '';
      lastKeyAt = Number.NEGATIVE_INFINITY;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const options = latest.current;
      const at = options.now(event);
      const gap = at - lastKeyAt;
      lastKeyAt = at;

      if (/^\d$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // Una pausa larga empieza una lectura nueva con este dígito.
        buffer = gap > options.maxKeyIntervalMs ? event.key : buffer + event.key;
        return;
      }

      if (event.key !== 'Enter') {
        // Las teclas modificadoras solas no cortan la ráfaga; cualquier otra, sí.
        if (!MODIFIERS.has(event.key)) reset();
        return;
      }

      const code = buffer;
      const isRead = code.length === options.digits && gap <= options.maxKeyIntervalMs;
      reset();
      // Otro lector registrado (otra instancia del hook) ya atendió esta lectura.
      if (!isRead || event.defaultPrevented) return;

      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target !== null && isEditable(target)) {
        if (target.hasAttribute(RFID_FIELD_ATTRIBUTE)) {
          event.preventDefault();
          event.stopPropagation();
          focusNextField(target);
          return;
        }
        if (!target.hasAttribute(RFID_TARGET_ATTRIBUTE)) return;
      }

      if (options.onRead === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      options.onRead(code);
    };

    // Fase de captura: se ve la tecla antes que cualquier manejador de la página.
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [enabled]);
}

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

function defaultNow(event: KeyboardEvent): number {
  return event.timeStamp;
}

/** ¿El elemento recibe texto? Ahí la lectura pertenece al campo, no a la búsqueda. */
export function isEditable(element: HTMLElement): boolean {
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return true;
  }
  if (!(element instanceof HTMLInputElement)) return false;
  return !NON_TEXT_INPUTS.has(element.type);
}

const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Pasa el foco al siguiente control del formulario (o de la página). */
function focusNextField(field: HTMLElement): void {
  const scope = field.closest('form') ?? document;
  const controls = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE));
  const next = controls[controls.indexOf(field) + 1];
  next?.focus();
}
