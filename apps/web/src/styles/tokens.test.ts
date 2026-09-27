import { describe, expect, it } from 'vitest';

import tokensCss from './tokens.css?raw';

/**
 * Contraste de los pares de color que usa la interfaz (06-ux-ui.md §8), leídos de
 * `tokens.css`: si alguien cambia un color, esta prueba dice si sigue siendo legible a pleno
 * sol.
 */

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokensCss);
  if (match?.[1] === undefined) throw new Error(`No existe el token --color-${name}.`);
  return match[1];
}

/** Luminancia relativa (WCAG 2.1). */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(token(foreground)), luminance(token(background))].sort(
    (a, b) => b - a,
  );
  return (light! + 0.05) / (dark! + 0.05);
}

describe('contraste de los tokens', () => {
  it.each([
    ['monte', 'sabana'],
    ['monte', 'superficie'],
    ['texto-2', 'sabana'],
    ['monte', 'chapeta'],
    ['monte', 'cerca'],
    // Texto principal de AlertBanner sobre su tinte.
    ['alerta-intenso', 'alerta-claro'],
    ['aviso-intenso', 'aviso-claro'],
    ['info-intenso', 'info-claro'],
  ])('texto principal %s sobre %s: al menos 7:1', (foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(7);
  });

  it.each([
    ['info', 'info-claro'],
    ['potrero', 'potrero-claro'],
    ['alerta', 'alerta-claro'],
    ['aviso', 'aviso-claro'],
    ['texto-2', 'neutro-claro'],
    // Botón principal: texto blanco sobre potrero.
    ['superficie', 'potrero'],
  ])('texto de Tag y controles %s sobre %s: al menos 4,5:1', (foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});
