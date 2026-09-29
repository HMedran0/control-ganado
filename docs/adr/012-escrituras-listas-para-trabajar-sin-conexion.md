# ADR-012: Escrituras listas para trabajar sin conexión

- Estado: aceptada (29/09/2026). Se aplica desde M5; lo existente se adapta en una tarea de M5.
- Requisitos: SYN-01 (fase 2), RN-11, RN-24
- Relacionadas: ADR-011 (idempotencia de la importación), ADR-014 (tecnología móvil)

## Contexto

La decisión del product owner es terminar la fase 1 tal como está planeada, hacer el piloto y
decidir la etapa comercial con sus resultados. La app móvil sin conexión (fase 2) no se hace ahora,
pero sí condiciona cómo se escribe desde ya: si las escrituras de la fase 1 no son repetibles ni
detectan conflictos, la sincronización obligará a rehacer la API y a migrar datos.

En la fase 1 ya existe parte de esto: el alta de animal acepta un `id` del cliente (aunque devuelve
el animal existente sin comparar el contenido), las tablas editables de catálogos y animales tienen
`version` con `VERSION_CONFLICT`, nada se borra físicamente (RN-11) y la importación de M4d es
idempotente con su propia clave (ADR-011).

## Decisión

### 1. `id` del cliente en toda creación

- Toda creación acepta un `id` opcional generado por el cliente: UUIDv7, validado con el esquema de
  `packages/shared` (`uuidv7` de `id.ts`).
- Si ya existe un registro de la finca con ese `id` y **el mismo contenido**, responde **200** con
  el registro, sin duplicar. «Mismo contenido» compara los campos que trae la petición con los
  guardados, normalizados como los guarda la API.
- Si existe con **otro contenido** (o es de otra finca), responde **409 `CLIENT_ID_CONFLICT`**.
- Sin `id`, la API lo genera, como hoy.

### 2. `Idempotency-Key` en las acciones que no son creaciones

- Las acciones que no crean un registro con `id` propio (salida, reversión, archivo, restauración,
  anulaciones, operaciones en lote, cierre de jornada…) aceptan el encabezado `Idempotency-Key`
  (UUID).
- La API guarda por finca la clave, la ruta, una huella de la petición y la respuesta, en la tabla
  `idempotency_keys` (única por finca y clave), durante **7 días**; una tarea las purga después.
- Misma clave y misma petición: devuelve la respuesta guardada, sin repetir la acción. Misma clave
  con otra petición (otra ruta u otro cuerpo): **422 `IDEMPOTENCY_KEY_REUSED`**.
- Es el patrón de la importación de M4d, generalizado: un candado consultivo por finca y clave,
  buscar la clave dentro de la transacción y guardar la respuesta en la misma transacción que la
  acción. Se aplica con un decorador en el controlador, no a mano en cada servicio.
- **La importación es el primer caso del patrón** y se queda como está: su clave vive en
  `import_batches.idempotency_key`, porque la respuesta que se repite es el propio lote (ADR-011).
- **`/auth` queda fuera:** sus endpoints no aceptan `Idempotency-Key` y `idempotency_keys` nunca
  guarda respuestas de ellos, que llevan tokens y cookies de sesión.

### 3. `version` en toda tabla editable

- Toda tabla que se edita con `PATCH` tiene `version` (entero) y la edición la envía. Si no
  coincide, responde el **`VERSION_CONFLICT`** que ya existe, con el mismo manejo en la web
  («Otra persona modificó este registro. Recargar los datos»). No se crea otro mecanismo.
- Los identificadores y los eventos (vacunaciones, pesajes, partos…) no se editan: cambian por
  acciones (retirar, reemplazar, anular), que van por el punto 2, así que no necesitan `version`.

### 4. Nada se borra físicamente

- Anulación o archivo con motivo (RN-11), como ya es la regla. Una anulación o un archivo es un
  cambio que la sincronización tiene que llevar, no una fila que desaparece.
- **Anular algo que ya está anulado** (o archivar lo archivado) responde **200 con el estado
  actual**, no error: repetir la acción es inofensivo y es justo lo que hace un cliente que reintenta.

### 5. `updated_at` en lo que se sincronizará

- Toda tabla que se sincronizará (animales, identificadores, catálogos, configuración, eventos,
  jornadas) tiene `updated_at timestamptz` e índice por (`farm_id`, `updated_at`). En los eventos
  también, porque anular es un cambio.
- **Lo mantiene un trigger de la base** (función `set_updated_at()`, `BEFORE UPDATE`), no el
  `@updatedAt` de Prisma: hay escrituras con SQL directo (clasificación, códigos, sesiones,
  importación en lote) que Prisma no ve.
- El endpoint de sincronización (SYN-01) **no se hace ahora**.

### Advertencia para SYN-01

El cursor de «cambios desde» **no puede ser `updated_at` solo**. Una transacción que empieza antes y
confirma después puede dejar filas con un `updated_at` anterior al cursor que el cliente ya pidió, y
esas filas no llegarían nunca. SYN-01 debe resolverlo con una ventana de solapamiento (pedir desde el
cursor menos un margen y descartar lo ya visto) o con una secuencia ligada a la transacción (por
ejemplo, el `xmin` de la fila con `pg_snapshot_xmin`). La decisión se toma en M12.

## Tarea en M5 (lo que ya existe)

Llevar los puntos 1 a 5 a las tablas de las fases ya hechas, con pruebas:

- Animales: el `id` del cliente compara el contenido (200 o `CLIENT_ID_CONFLICT`); salida,
  reversión, archivo, restauración y operaciones en lote aceptan `Idempotency-Key`.
- Identificadores: `id` del cliente al agregar; retirar y reemplazar con `Idempotency-Key`.
- Lotes, razas, vacunas, ciclos, etiquetas y configuración de la finca: `id` del cliente al crear;
  ya tienen `version`.
- `updated_at` con el trigger en todas esas tablas y en los eventos que existan. **Una prueba
  verifica que un `UPDATE` hecho con SQL directo cambia `updated_at`.**
- `idempotency_keys` con su purga, y una prueba de que `/auth` no la usa.
- Lo que se construya de M5 en adelante nace así.

## Cómo quedó en M5

- **`updated_at`**: `set_updated_at()` pone `now()` en todo `UPDATE` de 19 tablas (lista en 03 §2.7); los `INSERT` pueden traer su valor. La API y el seed trabajan con la sesión en UTC: sin eso, el adaptador de Prisma guardaba las marcas cinco horas corridas y el `now()` del trigger se leía cinco horas antes.
- **`Idempotency-Key`**: `@Idempotent()` agrega `IdempotencyInterceptor`, que valida la clave, calcula la huella (método, ruta con la query y cuerpo con las claves ordenadas) y devuelve la respuesta guardada sin ejecutar nada. El servicio escribe con `TransactionsService.run`, que dentro de su transacción toma `pg_advisory_xact_lock` por (finca, clave), vuelve a buscar la clave y guarda la respuesta junto con la acción; por eso lo que devuelve la transacción es la respuesta completa del endpoint. La respuesta repetida conserva su estado (201). Una clave de más de 7 días ya no cuenta aunque la purga (al arrancar y cada 6 horas) no la haya borrado.
- **`id` del cliente**: `ownRecordOrConflict` + `assertSameContent`; el 200 lo pone `ClientIdReplayInterceptor` a partir de una marca no enumerable en la respuesta.
- **`animal_tags`**: quitar una etiqueta marca `removed_at`; única vigente por animal y etiqueta.
- **Pendiente para M12**: `vaccination_cycle_vaccines` se reemplaza con borrado al editar un ciclo, y `work_session_entries` no tiene `farm_id`.

## Alternativas descartadas

- **Hacerlo en la fase 2, junto con la sincronización.** Obligaría a cambiar todos los contratos de
  la API y a migrar datos cuando ya haya fincas usándola.
- **Solo `Idempotency-Key`, también para las creaciones.** El `id` del cliente es más simple para
  la app sin conexión, que necesita el id antes de hablar con el servidor para enlazar registros
  (por ejemplo, la cría y su parto).
- **`@updatedAt` de Prisma.** No cubre las escrituras con SQL directo.

## Consecuencias

- Cada creación compara contenido y cada acción pasa por el decorador: algo más de código por
  endpoint, a cambio de reintentos seguros desde ya (también en la web, ante un doble clic).
- Dos errores nuevos en el catálogo: `CLIENT_ID_CONFLICT` (409) e `IDEMPOTENCY_KEY_REUSED` (422).
