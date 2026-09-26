# ADR-002 — Fechas de negocio como cadenas `YYYY-MM-DD` con tipo marcado

- **Fecha:** 2026-09-26
- **Estado:** Aceptada
- **Hito:** M0.2
- **Afecta:** `packages/shared/src/date.ts` y toda función de dominio que reciba fechas

## Contexto

`03-modelo-datos.md` §1 fija que las fechas de negocio (nacimiento, servicio, parto,
vacunación, pesaje, gasto) son de tipo `date` en PostgreSQL: sin hora y sin zona. CLAUDE.md
§6 prohíbe `new Date()` en lógica de negocio y exige que "hoy" venga del servicio `Clock` en
`America/Bogota`.

El riesgo concreto no es teórico. Con `Date` de JavaScript, `new Date('2026-09-26')` se
interpreta como medianoche **UTC**; leído en Bogotá (UTC−5) es el 25 de septiembre a las
19:00, y `getDate()` devuelve 25. Un animal nacido el 1 de marzo aparecería nacido el 28 de
febrero, con lo que la edad, la categoría de manejo, el corte de destete, la ventana de
brucelosis y la fecha estimada de parto se corren un día. Y al revés en Tokio (UTC+9).

Las funciones de dominio también deben ser deterministas: el plan (`07-plan-desarrollo.md`
§2.1) pide que el seed y las pruebas afirmen cifras exactas con `SEED_TODAY` fijo.

## Decisión

Las fechas de negocio se representan como **cadenas `YYYY-MM-DD` con un tipo marcado**:

```ts
declare const isoDateBrand: unique symbol;
export type IsoDate = string & { readonly [isoDateBrand]: true };
```

Se construyen únicamente con `toIsoDate(value)` (valida y marca) o `isoDateFromParts(y, m, d)`.
`packages/shared/src/date.ts` provee la aritmética de calendario: `addDays`, `addMonths`,
`daysBetween`, `compareIsoDates`, `isBefore`, `isAfter`, `lastDayOfMonth`, `isLeapYear`.

Motivos:

1. **No hay zona horaria que la mueva.** No existe instante ni desplazamiento; el 1 de marzo
   es el 1 de marzo en Bogotá, en Tokio y en el servidor.
2. **Es exactamente lo que viaja y lo que se guarda.** `date` de PostgreSQL y el JSON de la
   API usan la misma cadena; no hay conversión en los bordes, que es donde se pierde el día.
3. **Ordena y compara como texto.** `a < b` y `ORDER BY` coinciden; sirve para índices,
   cursores de paginación y `Array.prototype.sort` sin adaptadores.
4. **El tipo marcado impide mezclas.** `expectedCalvingDate({ serviceDate })` no acepta un
   `string` cualquiera ni un `Date`, así que una fecha sin validar no entra a las reglas.
5. **Las pruebas se leen.** `toIsoDate('2026-05-04')` dice qué día es sin pensar en meses
   contados desde cero.

Internamente la aritmética usa `Date.UTC` **como calculadora de calendario**: se parte la
cadena en año, mes y día, se opera en UTC y se vuelve a formatear con los captadores UTC.
Nunca se construye una fecha a partir de la hora local ni se usa `new Date()` sin argumentos,
así que el resultado no depende de `TZ`. Las pruebas se ejecutan con `TZ=America/Bogota` y con
`TZ=Asia/Tokyo` (`pnpm --filter @hato/shared test:tz`) para demostrarlo.

## Convención de meses cumplidos, con recorte a fin de mes

`ageInMonths(birthDate, today)` cuenta **meses cumplidos**. Cuando el mes de destino no tiene
el día de nacimiento, el mes se cumple el último día de ese mes:

| Nacimiento | Fecha      | Meses cumplidos |
| ---------- | ---------- | --------------- |
| 31/01/2026 | 28/02/2026 | 1               |
| 29/02/2024 | 28/02/2025 | 12              |
| 31/08/2026 | 30/11/2026 | 3               |

La alternativa (exigir el mismo día del mes) dejaría a un animal nacido el 31 de enero sin
cumplir el mes hasta el 3 de marzo, y retrasaría uno o tres días los cortes de destete (7
meses), de brucelosis (3 y 9 meses) y de los grupos de edad del ICA para todos los nacidos a
fin de mes. `addMonths` aplica el mismo recorte, de modo que las dos funciones son coherentes.

Consecuencia deliberada: la relación no es simétrica en los bordes. `addMonths('2026-01-31', 1)`
es `2026-02-28`, y sumar otro mes da `2026-03-28`, no `2026-03-31`. Es el comportamiento
habitual de las librerías de fechas y el que evita días inexistentes.

## Consecuencias

- La API convierte en los bordes: Prisma entrega `Date` para columnas `date` y el repositorio
  la pasa a `IsoDate` con `isoDateFromInstant(instant, 'UTC')` (Prisma las devuelve a
  medianoche UTC). Esa conversión vive en la capa de infraestructura, no en el dominio.
- El servicio `Clock` de M0.3 devuelve `IsoDate` usando
  `isoDateFromInstant(new Date(), 'America/Bogota')`, que es el único lugar donde aparece el
  instante actual. La función es pura porque recibe el instante como parámetro.
- Las marcas de tiempo (`created_at`, `voided_at`, …) **no** cambian: siguen siendo
  `timestamptz` y en TypeScript `Date`. La decisión cubre solo fechas de negocio.
- `id.ts` es la excepción justificada: un UUIDv7 lleva la marca de tiempo del instante en que
  se genera, que no es una fecha de negocio. `uuidv7({ now, random })` recibe ambos por
  parámetro y solo cae en `Date.now()` como valor por defecto, para que las pruebas sean
  deterministas.

## Alternativas descartadas

| Alternativa                    | Por qué no                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Date` de JavaScript           | Es un instante, no un día. Cualquier lectura con captadores locales corre la fecha en Bogotá; obliga a recordar UTC en cada línea.                                                                                                                                                                             |
| Luxon o date-fns con zona fija | Dependencia en un paquete que debe funcionar en API, web y React Native, para un problema que se resuelve con aritmética de calendario propia y probada. `date-fns` además opera sobre `Date`, así que no elimina la causa.                                                                                    |
| `Temporal.PlainDate`           | Es la respuesta correcta a futuro y encaja exactamente con el caso, pero todavía necesita polyfill en Node 24 y en React Native. Cuando esté disponible sin polyfill, `IsoDate` se puede cambiar por `PlainDate` detrás de las mismas funciones de `date.ts`, que es la razón de concentrar la aritmética ahí. |
| Entero de días desde una época | Compacto y ordenable, pero ilegible en las pruebas, en los registros y en el JSON.                                                                                                                                                                                                                             |
