# ADR-016 — Reparto de gastos, correcciones y montos en la auditoría

- **Fecha:** 2026-10-05
- **Estado:** Aceptada
- **Hito:** M7
- **Requisitos:** ECO-01 a ECO-06, RN-11, RN-17, RN-18, RN-20, AUD-01
- **Afecta:** `packages/shared/src/domain/allocation.ts` y `finance.ts`,
  `apps/api/src/finance/` (sobre todo `expense-writes.ts`), `apps/api/src/audit/audit.service.ts`,
  la migración `finance_corrections`

## Contexto

M0.2 dejó `allocateExpense` con el reparto exacto de RN-17: pesos enteros y el residuo a la
primera asignación. M7 tiene que registrar gastos, **corregirlos** y **anularlos**, y el
enunciado pide que, si un gasto se anula o se corrige, el reparto se recalcule y quede auditado.
Hay cuatro problemas:

1. **¿Quién es «la primera asignación»?** Dependía del orden en que llegaban los animales: el
   orden de un lote en la base, el de la selección del listado o el del seed. El mismo gasto con
   los mismos animales podía dar el residuo a otro animal, y una corrección que no tocaba el
   reparto lo movía.
2. **RN-11 y las asignaciones.** No hay borrado físico, y `expense_allocations` no tenía cómo
   anularse: corregir un gasto obligaba a editar montos en sitio o a borrar filas.
3. **Gastos que no son de ningún animal.** El 08 §1.12 dejaba la mano de obra, el arriendo y las
   cercas como «gasto general de la finca en el futuro», y el reporte económico (ECO-06) los
   necesita para que los gastos del período sean todos.
4. **La auditoría sin montos.** Desde M4c, `GET /audit` descartaba los campos con montos y no
   consultaba gastos ni ventas, aunque la ruta es solo del ADMIN, que ve los montos en todas
   partes. Una corrección de precio era invisible justo donde debía verse.

## Decisión

### 1. Orden determinista del reparto

`allocateExpense` ordena los animales por `animalId` antes de repartir y devuelve las
asignaciones en ese orden; **el residuo va siempre al primero de ese orden**. La comparación es por
unidades de código del texto del UUIDv7 en minúsculas, que es el mismo orden que `ORDER BY id`
de PostgreSQL sobre `uuid`; toda consulta que elige los animales de un reparto (los activos de un
lote, la selección) los trae con `ORDER BY id`. Un animal repetido es `VALIDATION_FAILED`. Así, el
mismo gasto con los mismos animales da siempre el mismo reparto, en shared, en la API y en el seed.

### 2. Asignaciones anuladas en lugar de editadas

`expense_allocations` tiene `voided_at` y `created_at`, y a lo sumo una asignación **vigente** por
gasto y animal (índice único parcial). Todo pasa por `expense-writes.ts`, que usan Finanzas, el
valor de compra del animal y el costo del tratamiento:

- **Corregir** (`PATCH /expenses/:id`, con `version`): si el reparto resultante es distinto, se
  anulan las asignaciones vigentes y se crean las nuevas en la misma transacción; el gasto
  conserva su id. Sin `allocation`, el reparto se vuelve a calcular **solo** si cambió el monto o
  la fecha (en uno por peso, los pesos dependen de la fecha), con los mismos animales y sin volver
  a validarlos: un animal archivado o vendido después conserva su parte. **Corregir solo la
  descripción, el tipo o la fecha de un gasto directo o general no toca ninguna asignación ni deja
  el reparto en la auditoría.** Si nada cambió, no se escribe ni se audita.
- **Anular** (`POST /expenses/:id/void`, con `Idempotency-Key`): el gasto y sus asignaciones
  vigentes quedan anulados; anular lo anulado responde 200.
- El gasto de un tratamiento y el de compra siguen siendo de su animal: desde Finanzas se corrigen
  el monto, la fecha y la descripción, no a quién se cargan. La compra no se registra como gasto
  suelto (`EXPENSE_PURCHASE_FROM_ANIMAL`): va en el formulario del animal.
- La inversión (RN-18) cuenta una asignación si ni ella ni su gasto están anulados, en shared
  (`animalInvestment`) y en SQL (CTE `investment`), comprobados animal por animal sobre el seed
  (`finance-equivalence.e2e-spec.ts`, como ADR-009).

### 3. Gasto general

`AllocationMethod.GENERAL`: un gasto de la finca sin asignaciones (y sin lote, por restricción
`CHECK`). No entra en la inversión de ningún animal y sí en los gastos del período del reporte, que
los muestra aparte.

### 4. Montos en la auditoría para el ADMIN

`GET /audit` es solo del ADMIN y, desde M7, **trae los montos**: deja de descartar `amount`,
`purchasePrice` y los demás, y consulta también gastos, ventas y avalúos. Que nadie más los reciba
lo garantizan el 403 de la ruta y la prueba de barrido de RN-20 (`rn20-sweep.e2e-spec.ts`), que
recorre todas las rutas `GET` y las escrituras permitidas como OPERATOR y VET.

La auditoría de un gasto guarda el reparto como mapa `animalId → monto`, antes y después. La
consulta lo muestra según dónde se mire:

- en la pestaña Cambios de un animal, **su parte** (`share`): «Su parte: $ 4.737 → $ 4.865»; la
  pestaña trae su venta y los gastos en los que tuvo parte, no sus avalúos;
- en las demás consultas, el **número de animales** (`animalCount`), para no volcar miles de
  montos.

## Consecuencias

- El residuo de los gastos del seed cambió de animal al entrar el orden por id; no movió ninguna
  cifra de `expected.ts` (que no tenía finanzas). Las cifras nuevas están en `EXPECTED_FINANCE`.
- Un gasto por lote se fija al guardarse: los animales que entren o salgan del lote después no
  cambian su reparto. Para repartir entre los de hoy hay que corregirlo y volver a elegir el lote.
- La auditoría de un reparto grande pesa: un gasto entre 5.000 animales guarda dos mapas de 5.000
  entradas por corrección. Es una operación rara y del ADMIN; si llegara a pesar, la alternativa es
  auditar por animal solo la diferencia.
- 06 §5.3 y 05 «Auditoría» cambian: la decisión de M4c («los montos nunca aparecen, ni siquiera
  para el ADMIN») queda reemplazada.
