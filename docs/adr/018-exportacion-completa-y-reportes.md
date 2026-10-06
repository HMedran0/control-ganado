# ADR-018 — Exportación completa de la finca, reportes estándar y gráficas

- **Fecha:** 2026-10-06
- **Estado:** Aceptada
- **Hito:** M8b
- **Requisitos:** BAK-02, RPT-02, RPT-03, CFG-03 CA1, RN-11, RN-20, RNF-01
- **Afecta:** `apps/api/src/export/`, `apps/api/src/reports/`, `packages/shared/src/domain/reports.ts`,
  `packages/shared/src/schemas/reports.ts`, `apps/web/src/features/export/`,
  `apps/web/src/features/reports/`, migración `20261006120000_audit_export`

## Contexto

M8b entrega la exportación completa que el ganadero descarga para tener su historia sin depender de
Arreo (BAK-02), los reportes estándar en Excel (RPT-02), el inventario por grupos de edad del ICA
(08 §2.2) y las gráficas (RPT-03). Quedaban abiertas varias preguntas:

1. **¿Excel o CSV?** BAK-02 CA1 admite los dos.
2. **¿Cómo generar decenas de miles de filas sin cargarlas en memoria**, y sin una foto
   inconsistente (un pesaje cuyo animal se creó a mitad de la exportación)?
3. **¿Cómo evitar el abuso?** Una exportación lee toda la finca.
4. **¿En qué orden van los reportes en cada sistema productivo?** ADR-017 lo dejó para M8b.
5. **¿Qué formato tiene el reporte del ICA?** El 08 define los grupos, no la presentación.

## Decisión

1. **Un `.xlsx` por entidad dentro de un ZIP, más un `LEEME.txt`.** El ganadero abre los archivos
   en Excel con configuración de Colombia: un CSV separado por comas queda en una sola columna y
   «12.50» se lee como 1.250. El `.xlsx` trae fechas y números con su tipo. Los nombres dentro del
   ZIP son solo ASCII (`prenez-y-partos.xlsx`), porque el explorador de Windows muestra mal los
   nombres no ASCII en muchos ZIP; el contenido y el LEEME van en español completo, el LEEME en UTF-8
   con BOM y CRLF para el Bloc de notas. Los encabezados de cada Excel y el LEEME salen de las mismas
   definiciones (`export-sheets.ts`): el LEEME no se desactualiza. Incluye lo archivado y lo anulado,
   marcado (RN-11); usuarios sin contraseña, sin sesiones ni intentos de inicio de sesión; todo texto
   protegido contra fórmulas (M4d). La auditoría se parte en `auditoria-2.xlsx`, `-3`… si pasa del
   millón de filas.
2. **Streaming con un escritor de ZIP propio y una foto `REPEATABLE READ`.** El escritor
   (`zip-writer.ts`, sin dependencias: `node:zlib` con DEFLATE y descriptor de datos) recibe cada
   libro de `exceljs` en streaming mientras se escribe; las filas se leen por bloques de 2.000
   ordenadas por `Id` y, si la descarga va más lenta que la base, se espera el `drain`. Todo dentro
   de una transacción `REPEATABLE READ READ ONLY` de hasta 10 minutos. Se prueba con el lector de la
   importación (`zip-guard`), con `unzip -t` y con `zipfile` de Python. DEFLATE también en los
   `.xlsx` (que ya vienen comprimidos), porque STORED con descriptor de datos no lo leen todos.
3. **Una exportación a la vez en el servidor y tres por hora por finca.** La transacción larga toma
   un candado global (`pg_try_advisory_xact_lock`): la segunda recibe 429 `EXPORT_IN_PROGRESS` con
   `Retry-After: 60`. El límite por finca se deduce de la auditoría (`AuditAction.EXPORT`, nueva),
   como el bloqueo del ADR-007: con tres en la última hora, 429 `EXPORT_LIMIT_REACHED` con
   `Retry-After` hasta que salga la más vieja. La exportación se audita en su propia transacción
   antes de escribir el ZIP, así que una descarga que falla también cuenta. `DomainError` gana
   `retryAfterSeconds`, que el filtro de problem+json envía como cabecera.
4. **Orden de los reportes por sistema (`reportOrder`, shared) [Validar].** Cría y doble propósito
   empiezan por los partos próximos y los nacimientos; levante y ceba, por el inventario, las
   salidas y el reporte económico; lechería, por los partos (que abren la lactancia) y el
   inventario; ciclo completo, por el inventario y los partos. Las vacunas y el formato ICA siguen
   en todos. El económico solo aparece para el ADMIN, en su lugar del orden. Pregunta 9 del 09 §6.
5. **Formato ICA [Validar].** Datos de la finca (nombre, municipio, departamento, código de predio
   ICA), fecha de corte (hoy) y una tabla por sexo con sus grupos del 08 §2.2 (siete en hembras,
   seis en machos) y los totales; los grupos en cero también salen. El grupo se calcula en SQL sobre
   la edad de `classified` y una prueba lo compara animal por animal con `icaAgeGroupFor`. Pregunta
   10 del 09 §6.
6. **Los agregados salen de SQL, sobre la clasificación del listado.** Inventario, grupos del ICA,
   pendientes de vacunación, partos próximos y distribución por categoría usan `classificationCtes`
   (ADR-009): cada cifra coincide con su listado o con el tablero, y las pruebas lo comparan. La
   evolución del inventario usa en SQL la regla `wasInHerdOn` de shared (entró ese día o antes, no
   había salido, no está archivado), comparada mes a mes. Pendientes de vacunación va en dos
   consultas: unir `vaccine_status` con `classified`, que ya la usa, hacía que PostgreSQL la
   materializara entera (p95 2,4 s con el seed de carga; ahora 474 ms).
7. **Gráficas en SVG propio, del ancho de su contenedor.** Como la de pesos (M6), sin librería, en
   la ruta `/reports/charts` que solo se carga al abrirla. Una unidad del SVG es un píxel (se mide
   con `ResizeObserver`): con un `viewBox` fijo, el texto quedaba en 6 px en el celular. Dos colores
   de serie nuevos (`--color-serie-1` verde, `--color-serie-2` azul), validados para daltonismo,
   nunca los de estado; cada gráfica tiene su tabla «Ver los datos».
8. **El PDF de la ficha individual queda para M19** (07 §6), con su propio ADR para elegir cómo
   generarlo (04 §7).

## Consecuencias

- Con el seed de carga (5.000 animales, 50.000 eventos), la exportación tarda unos 11 s, el primer
  byte llega a los 0,2 s, el ZIP pesa 4,6 MB (26 archivos, 6,5 MB sin comprimir) y el heap crece
  unos 9 MB en el pico. `test/perf/export.perf-spec.ts` lo reporta.
- La transacción de lectura dura lo que dure la descarga: con una conexión muy lenta y una finca
  enorme se corta a los 10 minutos y el ZIP queda incompleto (cualquier descompresor lo detecta).
- El límite cuenta las exportaciones fallidas: un ganadero con mala señal puede gastar sus tres
  intentos de la hora. Es a propósito (el costo para el servidor ya se pagó).
- Una finca nueva en M10a no necesita nada para la exportación ni los reportes.
- `REPORT_LABEL`, `ICA_AGE_GROUP_LABEL` y los textos de los enums que la exportación necesita viven en
  shared (`format/labels.ts`): la pantalla, el Excel y la exportación dicen lo mismo.
