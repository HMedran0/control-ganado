# ADR-015 — Ganancia diaria de peso y sus alertas

- **Fecha:** 2026-10-04
- **Estado:** Aceptada
- **Hito:** M6
- **Requisitos:** PES-02, PES-05 (y PES-06 en M8, que usa la misma ganancia de 90 días)
- **Afecta:** `packages/shared/src/domain/weights.ts`, `apps/api/src/animals/weight-gain.sql.ts`,
  la CTE `classificationCtes` (ADR-009) y `Farm.settings`

## Contexto

PES-05 pide, para cada animal, la ganancia diaria «entre los dos últimos pesajes, en los últimos
90 días y desde el nacimiento», y dos alertas: «Ganancia baja» si la de 90 días es menor que el
umbral de su categoría (`weightGainAlertKgPerDay`, 0,30 kg/día en Levante [Validar]) y «Perdió
peso» si el último pesaje baja más de `weightLossAlertPercent` (5 % [Validar]) respecto al anterior.
El 03 dejaba abierto cómo se calcula la de 90 días: regresión o primero y último del periodo.

Hay tres problemas concretos:

1. **El pesaje trimestral.** La finca de referencia pesa el levante cada tres meses (08 §3.2). Con
   una ventana estricta de 90 días casi nunca hay dos pesajes dentro: el 25/09/2026 la ventana
   empieza el 27/06 y solo trae el del 15/09; el anterior, del 15/06, queda 12 días por fuera. La
   alerta nunca saldría.
2. **Dos caminos que deben coincidir.** Las alertas se muestran con shared y se filtran y cuentan
   en SQL (ADR-009). Una pendiente calculada con coma flotante en JavaScript y con `regr_slope` en
   PostgreSQL puede diferir en el último decimal, y un animal justo en el umbral daría «baja» en un
   lado y no en el otro.
3. **Pesajes poco representativos.** Dos pesajes del mismo día, o separados pocos días, dan una
   pendiente que es más ruido de la cinta o de la báscula que ganancia.

## Decisión

### Ventana de 90 días con ancla

- Se toman los pesajes válidos (no anulados) con fecha en `[hoy − 90, hoy]`.
- Se agrega el **último pesaje anterior a la ventana** como ancla, si está a lo sumo
  `weightGainAnchorMaxDays` días antes del inicio de la ventana (180 por defecto [Validar], en
  `Farm.settings`). Si el ancla es más vieja, no se usa.
- Hace falta **al menos un pesaje dentro de la ventana**, **dos puntos** en total y **30 días o
  más** entre el primero y el último. Si no, no hay ganancia de 90 días ni alerta de ganancia baja.

Ejemplo, pesaje trimestral (hoy 25/09/2026): la ventana va del 27/06 al 25/09 y trae el pesaje del
15/09; el del 15/06 entra como ancla (12 días antes del inicio de la ventana); la ganancia es la de
esos dos, 92 días. Un animal sin pesajes desde marzo no tiene ganancia de 90 días: el ancla quedaría
a 104 días del inicio, pero no hay ningún pesaje dentro de la ventana.

### Regresión lineal, exacta

- La ganancia es la **pendiente de la regresión lineal por mínimos cuadrados** de todos esos
  puntos. Con dos puntos es exactamente (último − primero) / días, así que una finca que pesa poco
  no ve diferencia, y una que pesa a menudo no depende de un solo pesaje raro.
- Se calcula **con enteros**: los kilos en centésimas (la columna es `numeric(7,2)`) y las fechas en
  días. La pendiente es N / D con N = nΣxy − ΣxΣy y D = nΣx² − (Σx)², y en milésimas de kg/día es
  10·N / D.
- Se **redondea a milésimas de kg/día, mitad lejos de cero, antes de comparar** con el umbral:
  ⌊(20·|N| + D) / (2·D)⌋ con el signo de N. En shared con `BigInt`; en SQL con `numeric` y `div`
  (la división entera exacta: un `floor` sobre una división con decimales podría redondear antes).
  Así los dos caminos dan el mismo entero y la prueba de equivalencia los compara **exactos**,
  también en los casos justo en el umbral (0,2995 → 0,300, sin alerta; 0,2994 → 0,299, con alerta).
- Los umbrales de la configuración admiten hasta tres decimales y se pasan a milésimas.

### Las otras dos ganancias y las alertas

- **Entre los dos últimos:** el último pesaje (por fecha y, el mismo día, por orden de creación:
  el `id` es UUIDv7) y el último de una **fecha anterior**. Dos pesajes del mismo día no forman
  pareja.
- **Desde el nacimiento:** el peso al nacer (`is_birth_weight`) y el último pesaje.
- **Ganancia baja:** ganancia de 90 días redondeada < umbral de su categoría de manejo. Una
  categoría sin umbral no alerta.
- **Perdió peso:** 100 · (anterior − último) > `weightLossAlertPercent` · anterior, en centésimas de
  kilo y con el porcentaje entero. Exactamente el 5 % no alerta.
- Solo los animales activos tienen alertas, como las demás (ADR-009).

## Consecuencias

- `Farm.settings` gana `weightGainAnchorMaxDays`. Junto con `weightGainAlertKgPerDay` y
  `weightLossAlertPercent` se editan en Configuración → Finca.
- `classificationCtes` expone `gain_last_two_milli`, `gain_90_milli`, `gain_birth_milli`,
  `low_gain` y `weight_loss`; los filtros `alerts=low_gain` y `alerts=weight_loss` del listado y la
  página de Alertas los usan. La prueba de equivalencia de ADR-009 compara las tres ganancias y las
  dos alertas animal por animal sobre el seed y sobre una finca de casos borde.
- Un animal que pierde peso tiene además ganancia baja (su pendiente es negativa): en el seed, los
  cinco con ganancia baja incluyen los dos que perdieron peso.
- PES-06 (M8) estima la fecha del peso objetivo con esta misma ganancia de 90 días.

## Alternativas descartadas

| Alternativa                                  | Por qué no                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Primer y último pesaje de la ventana         | Con pesajes frecuentes depende de dos lecturas sueltas; la regresión usa todas y con dos da lo mismo.  |
| Ventana estricta de 90 días, sin ancla       | Con el pesaje trimestral de la finca de referencia la alerta no sale nunca.                            |
| Ancla sin límite de antigüedad               | Un pesaje de hace un año diría que el animal gana poco hoy por lo que pasó en otra época.              |
| Comparar en coma flotante con una tolerancia | Un animal en el borde quedaría distinto en la ficha y en el listado; con enteros no hay borde ambiguo. |
