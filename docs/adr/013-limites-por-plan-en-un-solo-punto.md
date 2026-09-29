# ADR-013: Límites por plan en un solo punto

- Estado: aceptada (29/09/2026). Se implementa en M5.
- Relacionadas: ADR-012, 07 §M11 (criterios del piloto)

## Contexto

Después del piloto puede venir una etapa comercial con planes (por número de animales, usuarios o
módulos). No se sabe todavía si habrá, ni cuáles, y en la fase 1 no se cobra nada. Si los límites
se agregaran después, habría que buscar y tocar cada endpoint que crea animales o usuarios; si se
pusieran ahora con reglas concretas, se estaría inventando un modelo comercial.

## Decisión

- Un servicio único en la API, `EntitlementsService`, con:
  - `can(farmId, feature)`: ¿la finca puede usar un módulo opcional?
  - `checkLimit(farmId, limit, cantidadNueva)`: ¿cabe `cantidadNueva` más en ese límite? Lanza el
    error si no cabe.
- Hoy toda finca tiene el plan **PILOT**, sin límites: el servicio siempre permite. **No hay
  columna de plan** en `farms` en la fase 1; llega con la etapa comercial, si la hay.
- Se llama desde un solo lugar por caso:
  - alta de animal, incluidas las crías de un parto (M5): `checkLimit(ANIMALS, n)`;
  - importación del inventario (M4d): `checkLimit(ANIMALS, filas que entran)`;
  - invitación de usuarios (M10a): `checkLimit(USERS, 1)`;
  - módulos opcionales: `can(MILK)` en leche (M9b) y `can(LIVE_SCALE)` en la báscula en vivo (M15).
- Error reservado **`PLAN_LIMIT_REACHED`**: está en el 05 como «reservado, sin uso en F1». Entra al
  catálogo de `packages/shared/src/errors.ts` cuando se implemente el servicio en M5, aunque nada lo
  lance todavía.
- **Nada de cobro, planes ni precios en la fase 1.**

## Alternativas descartadas

- **Nada ahora.** Agregar los límites después exige recorrer todos los puntos de creación.
- **Tabla de planes y límites desde ya.** Inventa un modelo comercial antes de saber si existe.

## Consecuencias

- Una llamada más en cada punto de creación y en cada módulo opcional, que hoy no hace nada.
- Una prueba verifica que con el plan PILOT todo se permite, y otra, con un plan de prueba con
  límite, que el alta de animal y la importación responden `PLAN_LIMIT_REACHED`.
