# ADR-017 — Tablero por sistema productivo, peso de venta y rendimiento de la clasificación

- **Fecha:** 2026-10-06
- **Estado:** Aceptada
- **Hito:** M8a
- **Requisitos:** RPT-01, CFG-03, PES-05 CA4, PES-06, RN-20, RN-27, RN-38, RNF-01
- **Afecta:** `packages/shared/src/domain/dashboard.ts`, `weights.ts`, `age.ts` y `reproduction.ts`,
  `packages/shared/src/schemas/farm-settings.ts` y `dashboard.ts`, `apps/api/src/dashboard/`,
  `apps/api/src/animals/classification.sql.ts` y `vaccine-status.sql.ts`,
  `apps/web/src/features/dashboard/`

## Contexto

M8 pide un tablero que responda las preguntas del día y destaque las del sistema productivo de
la finca (09 §4.1), con el peso objetivo de venta (PES-06), la ganancia por lote (PES-05 CA4) y el
intervalo entre partos (RN-38). Cada cifra debe enlazar al listado filtrado y coincidir con él
(RPT-01 CA1), y el tablero debe responder en menos de 2 s con 5.000 animales (RNF-01). Quedaban
abiertas varias preguntas:

1. **¿Qué es «este mes» en el peso de venta?** Con una fecha estimada que ya pasó y un último
   pesaje por debajo del objetivo, el animal ¿está en el peso o no?
2. **¿A quién se le aplica el peso de venta?** Con 450 kg solo en Levante, un novillo de ceba de
   más de 24 meses (la clasificación por edad lo llama «Toro») queda fuera, justo el que la finca
   está por vender; con 450 kg en Toro, aparecen los reproductores.
3. **¿Cuándo está un lote «por debajo de lo esperado»?** Un lote mezcla categorías con umbrales
   distintos.
4. **Doble propósito sin control lechero.** Todas sus preguntas propias son de leche (M9b).
5. **Rendimiento.** Medido con el seed de carga, el tablero tardaba de 8 a 11 s y la lista de
   vacunas vencidas ya estaba en un p95 de 2 s.

## Decisión

1. **El tablero son secciones, y el sistema productivo elige cuáles.** `GET /dashboard` siempre
   trae las cifras comunes de RPT-01 y solo las secciones de `systemQuestions(sistema)` (shared).
   Cambiar el sistema cambia las preguntas, nunca las cifras comunes (CFG-03 CA1). Las preguntas de
   leche que necesitan M9b no existen todavía: doble propósito muestra las de cría y «¿Cuáles están
   en retiro de leche?», que sale de los tratamientos. `alertGroupOrder` ordena los grupos de
   Alertas por sistema. Las referencias de UPRA (2024) son texto, nunca umbral ni color.
2. **Una pasada de la clasificación.** Todas las cifras de los activos salen de una consulta sobre
   `classificationCtes` (ADR-009), materializada una vez; por eso cada una coincide con el total
   del listado o de Alertas al que enlaza, y una prueba de integración lo compara cifra por cifra.
   «¿Qué falta vacunar?» cuenta cada animal una vez (vencidas o pendientes o próximas). El
   intervalo entre partos es una consulta aparte, sin la clasificación. La inversión solo se
   consulta para el ADMIN (RN-20); el barrido de `rn20-sweep` cubre la ruta por descubrimiento.
3. **Peso de venta: lo medido y lo estimado, separados** (`saleWeightProjection`). «Ya en el peso»
   es el último pesaje ≥ objetivo. Si no, con ganancia de 90 días positiva (ADR-015), la fecha
   estimada es el último pesaje más ⌈faltante / ganancia⌉ días, en enteros (centésimas de kilo y
   milésimas de kg/día), igual en shared y en SQL. Esa fecha entre hoy y el último día del mes es
   «este mes»; antes de hoy, «posiblemente en el peso: pésalo para confirmar»; después, «más
   adelante». Cada situación es un filtro del listado (`saleWeight`).
4. **El peso de venta aplica por categoría, y los reproductores se excluyen con una etiqueta del
   sistema.** `targetSaleWeightKg` trae 450 kg en Levante y en Toro [Validar]. Un macho con la
   etiqueta del sistema `REPRODUCTOR` («Reproductor», como `COTERO`) no tiene peso de venta. Se
   eligió la etiqueta y no un campo del animal porque no necesita migración, se asigna con lo que
   ya existe (ficha, formulario, operaciones en lote) y se filtra con `tags=REPRODUCTOR`. Las
   categorías no cambian: que «Toro» nombre también al novillo de ceba es un hallazgo de dominio
   para el piloto (09 §6, pregunta 7).
5. **Lote por debajo de lo esperado:** sobre los animales del lote que tienen umbral y ganancia de
   90 días, el promedio de sus ganancias es menor que el promedio de sus umbrales. Sobre el mismo
   conjunto es comparar sumas, en enteros. Cada lote enlaza a Alertas con «Ganancia baja» y ese
   lote.
6. **Destete del mes = nacidos en el mes M − W.** Con meses cumplidos y recorte a fin de mes
   (ADR-002), quien nace en el mes M − W cumple W meses dentro del mes M y nadie más lo hace; el
   filtro del listado es un rango de nacimiento (`bornFrom`, `bornTo`), sin reglas nuevas en SQL.
7. **Rendimiento de la clasificación**, medido con el seed de carga y cubierto por la prueba de
   equivalencia:
   - `cycle_applied` (estado de vacunas) consulta `vaccination_records` con su índice
     `(farm_id, animal_id, vaccine_id, applied_on)` en lugar de la CTE `vs_records`, que no tiene
     índice y se recorría por cada par animal-vacuna: contar vacunas vencidas pasó de 1,2 s a 0,07 s.
   - La edad se calcula una vez por animal (`LATERAL` con `OFFSET 0`): `hato_months_between` no se
     expande en línea, y cada uso de la categoría (umbral de ganancia, peso de venta) la volvía a
     llamar. El peso de venta pasó de 3,1 s a 0,44 s. Se probaron y descartaron una barrera sobre
     toda la CTE (empeora el resto de las consultas) y una unión con `VALUES` por categoría
     (cambia el plan y lleva cualquier conteo a 1,5 s).
   - La etiqueta «Reproductor» es una unión con una lista distinta, que el planificador elimina si
     nadie la usa, no un `EXISTS` que se repite en cada expresión.

   Resultado: tablero con p95 de 887 ms; vacunas vencidas, de 2.018 a 275 ms.

8. **Inicio en 3G.** El componente de Inicio va en su propio chunk (fuera de los 165 KB de la carga
   inicial) y la guarda de `_app` pide `GET /dashboard` en cuanto hay sesión, sin esperar a los
   chunks. `inicio-3g.spec.ts` mide con «Fast 3G» y CPU ×4 y reporta sin fallar: `vite preview`
   sirve HTTP/1.1 (con proxy no usa HTTP/2) y las ~60 peticiones van de a 6 (8,1 a 8,6 s). La meta
   de 4 s se comprueba en M10b con HTTP/2 detrás de Caddy.

   **Actualización M8b.** Se aplicó la palanca de la última consecuencia: `vite.config.ts` agrupa los
   chunks con `codeSplitting.groups` de Rolldown (`inicial` con lo que ya cargaba `index.html`,
   `app-shell` con el layout y `inicio` con el tablero) y un plugin los precarga desde
   `index.html` con `modulepreload` y `data-precarga`, en paralelo con la carga inicial y el
   refresco. La precarga tiene su propio tope (`hato.preloadBudgetKb`, 30 KB; quedó en 24,9) y la
   carga inicial bajó de 162,5 a 155,4 KB (un archivo comprime mejor que cuatro). En `vite
preview`: de 62 a 10 peticiones, de 256 a 239 KB y la primera cifra de 8,9–10,2 s a 4,1–4,3 s.
   Costo: quien abre directamente otra ruta también baja Inicio. M10b sigue midiendo con HTTP/2.

## Consecuencias

- El tablero, el listado y Alertas cuentan con la misma CTE: cambiar una regla de clasificación
  cambia los tres a la vez, y la prueba de equivalencia sigue siendo la red.
- Una finca nueva (M10a) debe nacer con las etiquetas de sistema `COTERO` y `REPRODUCTOR`; hoy solo
  las crea el seed. Sin `REPRODUCTOR`, ningún animal es reproductor y todos los machos con
  objetivo tienen peso de venta.
- El promedio de días para la venta depende de los datos: en El Retiro, los machos de M4c ganaban
  tan poco que pasaba de mil días. Es una cifra, no una alerta. En M8b el seed les dio una ganancia
  realista (0,4 a 0,7 kg/día hasta 550 kg) y el promedio quedó en 244 días.
- En HTTP/1.1, Inicio no llega a 4 s en 3G: hacen falta HTTP/2 o menos archivos. Si en M10b no
  alcanza, la siguiente palanca es juntar los chunks del layout y de Inicio (unos 36 archivos
  pequeños) y precargar su código mientras se refresca la sesión, que en HTTP/1.1 compite con el
  refresco y por eso no se dejó en M8a. (Hecho en M8b: ver la actualización de la decisión 8.)
