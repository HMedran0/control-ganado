# ADR-009 — Clasificación de animales en SQL, comprobada contra shared

- **Fecha:** 2026-09-27
- **Estado:** Aceptada
- **Hito:** M4a
- **Afecta:** `apps/api/src/animals/classification.sql.ts`, la migración
  `20260927172540_animal_classification_support`, RN-27 y `03-modelo-datos.md` §4

## Contexto

La categoría de manejo y las etiquetas derivadas (RN-06, RN-07, RN-08, RN-25) se calculan,
no se almacenan (RN-16). Las reglas viven en `packages/shared/src/domain` (`managementCategory`,
`derivedTags`) y RN-27 exige que el tablero, los listados, los reportes y la importación usen
**las mismas** funciones.

Para mostrar un animal eso es fácil: se leen sus preñeces y tratamientos y se llama a shared.
Para **filtrar y contar** no: `GET /animals?tags=PREGNANT` sobre 5.000 animales (RNF-01) no
puede traer el hato completo a la memoria de la API en cada petición para quedarse con 64, y
el tablero de M8 va a contar por categoría. Hace falta que la base filtre, y la base no ejecuta
TypeScript.

## Decisión

1. **Una CTE parametrizada, construida en TypeScript**, en `classification.sql.ts`
   (`classificationCtes`). No es una vista porque «hoy» y los parámetros de la finca
   (destete, ventanas de alerta) son datos de cada petición, y una vista no recibe parámetros.
2. **Todo valor entra como parámetro** de `Prisma.sql`: la fecha de hoy (del `Clock`), los
   parámetros de la finca (leídos de `farms.settings` en cada petición, nunca fijos), la edad de
   toro (`ADULT_MALE_AGE_MONTHS`, importada de shared) y los códigos de categoría, etiqueta y
   desenlace. El texto fijo solo tiene nombres de columnas, tablas y tipos. Los fragmentos que
   dependen del cliente (orden, etiqueta derivada, alerta) salen de listas cerradas.
3. **La única aritmética de reglas que vive en la base** es `hato_months_between`, la
   traducción literal de `monthsBetween` (ADR-002, con recorte a fin de mes), creada en la
   migración como función SQL `IMMUTABLE`.
4. **El SQL filtra y cuenta; shared muestra.** Cada fila del listado y la ficha se calculan
   con `managementCategory`, `derivedTags` y `animalAlerts` a partir de las columnas crudas
   que la CTE también devuelve (partos, último parto, preñez abierta, retiro).
5. **Una prueba de equivalencia** (`test/classification-equivalence.e2e-spec.ts`) compara el
   SQL con shared:
   - `hato_months_between` contra `monthsBetween` en más de 100.000 pares de fechas, con
     fines de mes y el 29 de febrero;
   - los 297 animales de la finca de referencia, animal por animal y campo por campo, el
     25/09/2026, el 15/11/2026 y con otros parámetros guardados en la finca (destete a 8 meses
     y otras ventanas de alerta);
   - una finca de casos borde que el seed no tiene (preñeces y tratamientos anulados, parto un
     31 de enero, nacimiento un 29 de febrero, retiro que vence hoy, servida con 90 y 91 días).

   Si alguien cambia una regla en shared y no en el SQL, o al revés, la prueba dice qué animal
   y qué campo difieren.

6. **Las alertas de vacunas no se traducen a SQL.** `vaccineStatus` tiene cuatro tipos de
   programación y ciclos oficiales (RN-13, ADR-004); duplicarlo sería el mayor riesgo de
   divergencia. El filtro `alerts=vaccine_overdue|vaccine_due` lo calcula con shared para los
   activos de la finca y le pasa al SQL la lista de animales que cumplen. Medido con el seed
   de carga: p95 de 0,5 s, dentro de RNF-01. Si el tablero de M8 lo necesita más rápido, se
   traduce entonces, con su propia prueba de equivalencia.
7. **Parto vencido sin registrar (M5, RN-39).** La CTE calcula `calving_overdue` con
   `overdueCalvingAlertDays` leído de la finca, igual que las demás alertas reproductivas, y la
   prueba de equivalencia la compara con `isCalvingOverdue`, sobre el seed (que trae 2 casos) y
   sobre casos creados por la API.

## Consecuencias

- Hay dos implementaciones de la clasificación, y RN-27 se cumple por prueba, no por
  construcción. El costo es mantener la CTE al cambiar una regla; la prueba lo hace
  imposible de olvidar.
- Los reportes y el tablero (M8) deben reutilizar `classificationCtes` y no escribir su propia
  versión.
- Durante la medición apareció un costo oculto: `isoDateFromInstant` creaba un
  `Intl.DateTimeFormat` por llamada (unos 100 µs). Con miles de fechas por consulta eso
  sumaba segundos, así que ahora se reutiliza uno por zona horaria.
- El controlador de PostgreSQL de Prisma reinterpreta como hora local un parámetro de texto
  con forma de instante ISO (`…T12:00:00.000Z`). Por eso el cursor de la línea de tiempo
  viaja como una sola clave de texto calculada en SQL, y no como un instante.
