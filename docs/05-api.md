# Contrato de la API REST

Base: `/api/v1`. JSON UTF-8. Autenticación: `Authorization: Bearer <accessToken>` salvo en `/auth/*`.
Los esquemas de entrada y salida se definen con zod en `packages/shared/src/schemas` y son la fuente de verdad; esta tabla es el índice.

## Convenciones
- IDs: UUIDv7 en string. **Toda creación** acepta un `id` generado por el cliente (ADR-012, desde M5): si ya existe con el mismo contenido, 200 con el registro, sin duplicar; si existe con otro contenido (o es de otra finca), 409 `CLIENT_ID_CONFLICT`.
- Acciones que no son creaciones (salida, reversión, archivo, restauración, anulaciones, operaciones en lote…): encabezado opcional `Idempotency-Key` (UUID, ADR-012, desde M5). La misma clave con la misma petición devuelve la respuesta guardada (7 días, por finca); con otra petición, 422 `IDEMPOTENCY_KEY_REUSED`. Los endpoints de `/auth` no lo aceptan. La importación usa su propia clave `importKey` (ADR-011), el primer caso de este patrón.
- Fechas de negocio: `YYYY-MM-DD`. Marcas de tiempo: ISO 8601 con zona.
- Dinero: string decimal (`"1250000.00"`). Peso: número con hasta 2 decimales.
- Listados: paginación por cursor `?limit=50&cursor=<opaco>` → `{ items, nextCursor }`. Máximo `limit` 200.
- Filtros por query string; múltiples valores separados por coma (`?tags=PREGNANT,CALVED`).
- Actualizaciones: `PATCH` con `version` obligatoria → 409 `VERSION_CONFLICT` si no coincide.
- Anulación de eventos: `POST /<recurso>/:id/void` con `{ reason }`. Anular algo que ya está anulado (o archivar lo archivado) responde 200 con el estado actual, no error (ADR-012).
- Límites por plan (ADR-013): toda finca tiene el plan PILOT, sin límites; `PLAN_LIMIT_REACHED` está reservado. `EntitlementsService` se llama desde el alta de animal, las crías del parto y la importación.
- **Implementación de ADR-012 (M5).** El `id` del cliente es un UUIDv7 (`clientIdSchema` de shared). Una creación repetida con el mismo contenido responde **200** (la primera, 201); «mismo contenido» compara los campos de la petición como quedarían guardados (lo omitido, con su valor por defecto) y, en el animal, también las etiquetas e identificadores vigentes y el peso inicial. `Idempotency-Key` se acepta en las rutas marcadas con `@Idempotent()`: salida, reversión, archivo, restauración, operaciones en lote, retiro y reemplazo de identificadores, palpación, aborto, anulación de preñez y parto. La respuesta guardada se repite con **su mismo estado** (201 si la acción respondió 201). La acción y la respuesta se guardan en la misma transacción, con un candado consultivo por (finca, clave): dos reintentos simultáneos se esperan entre sí; dos acciones con claves distintas de la misma finca, no. Si la acción falla, no queda nada guardado y el reintento vuelve a intentarlo. Una clave que no es UUID responde `VALIDATION_FAILED`.
- Errores: `application/problem+json` con `code` estable (catálogo en `packages/shared/src/errors.ts`). Algunos traen además `context` con los datos que la interfaz necesita para ofrecer la salida: `IDENTIFIER_TAKEN` e `IDENTIFIER_PREVIOUSLY_USED` envían `{ animalId, animalCode }` del animal que tiene o tuvo el identificador, para enlazar a su ficha.
- Roles: columna "Rol" (T = todos, A = ADMIN, V = VET, O = OPERATOR; — = público, sin sesión).
- **Ningún token viaja en la query string** (invitación, verificación, recuperación, intenciones de Google aparte de la del flujo): va en el cuerpo de un `POST`. Los enlaces de los correos lo llevan en el fragmento (`#token=…`), que nunca llega al servidor (ADR-007 decisión 7).
- Los correos se comparan normalizados (sin espacios, en minúsculas) en invitaciones, verificación, recuperación y Google.

## Autenticación
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | /auth/login | — | `{ login, password }` (usuario o correo) → `{ accessToken, user, farm, role }` + cookie refresh |
| POST | /auth/refresh | — | Rota refresh token → nuevo `accessToken`. Extiende la sesión (AUT-10); al cumplirse el tope, 401 `AUTH_SESSION_MAX_AGE` |
| POST | /auth/logout | T | Revoca el refresh token |
| POST | /auth/change-password | T | `{ currentPassword, newPassword }` |
| GET | /auth/config | — | `{ google: boolean, passwordRecovery: boolean }`: qué ofrece la pantalla de inicio de sesión (M10a). Sin `GOOGLE_*`, `google` es `false`; sin SMTP, `passwordRecovery` es `false` |
| GET | /me | T | Usuario, finca y rol actuales; incluye `emailVerified` y los métodos de acceso vinculados |
| GET | /auth/sessions | T | Sesiones abiertas del usuario (AUT-11, M4d): `{ items: [{ id, device, startedAt, lastUsedAt, current }] }`, de la usada más recientemente a la más antigua. `id` es la familia; `device` sale del `userAgent` («Chrome · Android»); `current` marca «Este equipo» |
| POST | /auth/sessions/:id/revoke | T | Cierra una sesión propia → `{ ok: true, current }`. Si es la actual, equivale a salir (borra la cookie). Una sesión que no es del usuario, 404 |
| POST | /auth/sessions/revoke-others | T | Cierra todas las sesiones propias menos la actual → `{ revoked }` |
| POST | /auth/forgot-password | — | `{ email }` → 202 siempre, exista o no la cuenta (AUT-14, M10a). Solo envía a correos verificados; 3 por correo por hora |
| POST | /auth/reset-password | — | `{ token, newPassword }` → revoca todas las sesiones y entrega una nueva. `EMAIL_TOKEN_INVALID` si venció o ya se usó |
| POST | /auth/verify-email | — | `{ token }` → marca el correo como verificado (AUT-14 CA1) |
| GET | /auth/google/start | — | Redirige a Google (AUT-15, M10a). Sin parámetros, inicio de sesión; con `?intent=` (intención de un solo uso de 5 min), vincular o aceptar una invitación. Guarda `state`, `nonce` y `code_verifier` en el servidor |
| GET | /auth/google/callback | — | Retorno de Google: valida `state` e `id_token`, deja la cookie del refresco y redirige a la web. Los errores redirigen a la web con el código en el fragmento (`#error=GOOGLE_NO_ACCESS`) |

**Sesiones (M4d, ADR-007 decisión 6).** Cada renovación extiende el refresco a `REFRESH_TTL_DAYS` desde ese momento, sin pasar de `REFRESH_MAX_AGE_DAYS` desde el inicio de sesión que originó la familia; la cookie dura lo mismo. El token de acceso lleva la sesión en el claim `sid` y cada petición comprueba que siga abierta: cerrar una sesión (propia, las demás, o todas las de un usuario por el ADMIN), cambiar o restablecer la contraseña y desactivar al usuario cortan su acceso de inmediato con `AUTH_TOKEN_EXPIRED`. Un token sin `sid` (emitido antes de M4d) ya no sirve y la web lo renueva sola. `last_used_at` se escribe al renovar, como máximo una vez por hora.

## Usuarios y finca
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | /users | A | Usuarios de la finca |
| POST | /users | A | Crear usuario (`username` obligatorio, `email` opcional salvo para ADMIN: `EMAIL_REQUIRED_FOR_ADMIN`) con rol y contraseña temporal. Sigue siendo el camino para quien no tiene correo (AUT-13 CA4) |
| PATCH | /users/:id | A | Editar nombre, rol, activo. Pasar a ADMIN a alguien sin correo responde `EMAIL_REQUIRED_FOR_ADMIN`; desactivarlo revoca sus sesiones |
| POST | /users/:id/reset-password | A | Genera contraseña temporal |
| POST | /users/:id/sessions/revoke | A | Cierra todas las sesiones de un usuario de la finca, también las de sus otras fincas (AUT-11 CA3, M4d): equipo perdido o prestado → `{ revoked }`, auditado. Usuario de otra finca, 404 |
| GET | /invitations | A | Invitaciones pendientes, aceptadas y anuladas de la finca (AUT-13, M10a) |
| POST | /invitations | A | `{ email, role }` → envía el enlace (7 días). Si el correo ya es de un usuario de **otra** finca, la invitación se crea igual; `INVITATION_EMAIL_TAKEN` solo si ya es miembro de esta finca |
| POST | /invitations/:id/resend | A | Genera un token nuevo (el enlace anterior deja de servir) y lo reenvía |
| POST | /invitations/:id/revoke | A | Anula la invitación |
| POST | /invitations/preview | — | `{ token }` → `{ farmName, role, email, userExists }` para la pantalla de aceptar. `INVITATION_INVALID` si venció, se usó o se anuló |
| POST | /invitations/accept | — / T | `{ token, name?, username?, password? }` → sesión. Si el correo es de un usuario existente, basta con su sesión iniciada (o con su contraseña) y se le agrega la membresía; si no, crea el usuario. Verifica el correo |
| POST | /invitations/google | — | `{ token }` → `{ intent }`: intención de un solo uso (5 min) para aceptar con Google en `/auth/google/start?intent=…` |
| POST | /me/email | T | `{ email, currentPassword }` → cambia el correo y envía el enlace de verificación (24 h); hasta verificarlo, no sirve para recuperar ni para Google |
| POST | /me/email/verification | T | Reenvía el enlace de verificación |
| POST | /me/identities/google/link | T | `{ currentPassword }` → `{ intent }`: intención de vínculo de un solo uso (5 min). El navegador va a `/auth/google/start?intent=…` y el retorno vincula por (`provider`, `subject`) |
| POST | /me/identities/google/unlink | T | `{ currentPassword }` → desvincula. `LAST_LOGIN_METHOD` si es su único método de acceso |
| GET | /farm | T | Datos y parámetros. `settings.pricePerKgByCategory` solo viaja para ADMIN (RN-20). Desde M4c, M6, M8 y M9b, `settings` incluye `codeReuse`, `codeSuggestion`, `productionSystem`, `salesFocus`, `dryOffBeforeCalvingDays`, `weightGainAlertKgPerDay`, `weightLossAlertPercent` y `targetSaleWeightKg` (03 §2.1). `productionSystem`, `salesFocus` (o `null`) y `targetSaleWeightKg` (kilos enteros de 50 a 1.500 por categoría) existen desde M8a y solo los cambia el ADMIN con `PATCH /farm`. Cambiar `codeReuse` de `true` a `false` con números repetidos responde `CODE_REUSE_CONFLICT` con los animales en `context` |
| PATCH | /farm | A | Editar datos y `settings` (parciales: se mezclan con los guardados y se valida el resultado). Exige `version` |
| GET/POST/PATCH | /breeds, /breeds/:id | T lee, A escribe | Catálogo de razas |
| GET/POST/PATCH | /vaccines, /vaccines/:id | T lee, A/V escribe | Catálogo de vacunas (incluye `scheduleType` y elegibilidad) |
| GET/POST/PATCH | /vaccination-cycles, /vaccination-cycles/:id | T lee, A escribe | Ciclos oficiales y sus vacunas (SAN-06) |
| GET | /vaccination-cycles/:id/progress | T | Vacunados y pendientes por vacuna del ciclo (M6): `{ cycle, state: CURRENT|CLOSED|UPCOMING, vaccines: [{ vaccineId, name, eligible, vaccinated, pending }] }`. El denominador son los activos de sexo elegible que estaban en la finca antes del cierre (ADR-004) |
| GET/POST/PATCH | /lots, /lots/:id | T lee, A escribe | Lotes |
| GET/POST/PATCH | /tags, /tags/:id | T lee, A escribe | Etiquetas manuales. La `key` se genera al crear y no cambia al renombrar; `COTERO` no se desactiva ni se renombra (`SYSTEM_TAG_PROTECTED`) |
| GET | /lots/:id/deactivation-warnings | A | Lo que advertiría desactivar el lote (`LOT_HAS_ACTIVE_ANIMALS`), para mostrarlo antes de confirmar |
| GET | /vaccines/:id/deactivation-warnings | A/V | Lo que advertiría desactivar la vacuna (`VACCINE_IN_ACTIVE_CYCLE`) |

**Catálogos (M3).** Los listados devuelven `{ items, nextCursor: null }`: son pequeños y no se paginan. Por defecto solo traen los activos; `?includeInactive=true` incluye los desactivados. No hay `DELETE`: se desactiva con `PATCH { isActive: false, version }`, y la respuesta trae `warnings` si el elemento sigue en uso. Los nombres son únicos por finca sin distinguir mayúsculas ni espacios sobrantes (`CATALOG_NAME_TAKEN`). Crear un ciclo que se cruza con otro responde con la advertencia `CYCLE_OVERLAP`.

## Animales
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | /animals | T | Listado con filtros: `q, sex, breedId, lotId, tags, status(active,exited,archived), ageMinMonths, ageMaxMonths, alerts(vaccine_overdue,vaccine_due,calving_soon,withdrawal), forSale, sort` |
| GET | /animals/search?q= | T | Búsqueda global; si `q` coincide exactamente con un identificador activo o anterior responde `{ exactMatch: {animalId, via} }` |
| POST | /animals | T | Crear (ANI-01). Si `origin=PURCHASED` y rol A, acepta `purchasePrice` |
| GET | /animals/:id | T | Ficha: datos, identificadores, etiquetas derivadas y manuales, edad, alertas, resumen reproductivo, último peso. Campos económicos solo para A |
| PATCH | /animals/:id | T | Editar (con `version`) |
| POST | /animals/:id/archive | A | `{ reason }` |
| POST | /animals/:id/restore | A | Restaurar archivado. `{ newCode? }` si su código ya lo tiene otro animal |
| POST | /animals/:id/exit | A | `{ type, date, reason?, sale?: { amount, buyer? }, confirmWithdrawal? }` |
| POST | /animals/:id/revert-exit | A | Revierte salida (y anula la venta asociada). `{ newCode? }` si su código o su chapeta los tiene otro activo |
| GET | /animals/:id/timeline | T | Historial unificado paginado |
| GET | /animals/:id/genealogy | T | Madre, padre, crías (2 niveles) |
| POST | /animals/bulk/tags | T (forSale solo A) | `{ animalIds, add?: [], remove?: [], forSale? }` |
| POST | /animals/bulk/lot | T | `{ animalIds, lotId, date }` crea `LotMovement` |
| GET | /animals/export.xlsx | T | El listado en Excel con los mismos filtros que `GET /animals`, sin paginar (ANI-06 CA4, M4d). Valor de compra solo para A |
| GET | /animals/labels | A | Hoja de etiquetas con QR (IDN-03 CA2, M4d): `?ids=` (selección, hasta 200) o los filtros del listado → `{ items: [{ id, code, name, sex, visualTag, din, rfid, qrUrl }], truncated }` (hasta 1.000) |
| GET | /animals/next-code?birthDate=&count= | T | Siguiente código sugerido según `codeSuggestion`: `calfCodePattern` o el menor número libre (ANI-10) → `{ code, codes }`. `count` (1 a 3, M5) pide varios distintos entre sí, para las crías de un parto gemelar |

**Detalles de M4a.**
- Cada fila trae `expectedCalvingDate`: el parto estimado de la preñez abierta confirmada, o `null` (columna «Parto estimado» de 06 §5.2).
- `GET /animals` responde `{ items, nextCursor, total }`: `total` es el conteo con los filtros aplicados, sin paginar. Filtros: `category` (`CALF_MALE, CALF_FEMALE, HEIFER, COW, YOUNG_MALE, ADULT_MALE`); `tags` recibe etiquetas derivadas (`SERVED, PREGNANT, CALVED, DRY, WITHDRAWAL`) y claves de etiquetas manuales (`COTERO`…) en la misma lista; `alerts` acepta además `unconfirmed_service` (servida sin diagnóstico, RN-08). Varios valores de `category`, `breedId` o `lotId` se combinan con «o»; varios de `tags` o `alerts`, con «y». `status` es `active` por defecto; `archived` solo para ADMIN. `sort`: `code`, `age` (de menor a mayor edad), `lastWeight` y sus inversos con `-`; sin peso, al final. Solo los animales activos tienen alertas.
- **Desde M8a**, `GET /animals` (y su exportación) acepta además: `bornFrom` y `bornTo` (nacidos entre esas fechas, ambas incluidas; `bornTo` antes de `bornFrom` → `VALIDATION_FAILED`), `saleWeight` (`reached`, `this_month`, `likely_reached` o `later`, PES-06; solo activos) y `milkWithdrawal` (`true`: retiro de leche vigente; solo activos). `sort=calving` ordena por parto estimado, el más próximo primero, y deja al final a quien no tiene preñez confirmada (CU-03). El resumen de peso de cada fila, de la ficha y de `GET /animals/:id/weights` trae `saleWeight: { targetKg, status, estimatedOn } | null` (PES-06 CA2; `estimatedOn` es `null` si ya está en el peso).
- `GET /animals/search?q=` → `{ exactMatch: { animalId, via, matches } | null, items }`. `via` y cada elemento de `matches` dicen por qué coincidió: `{ kind: 'CODE' | 'NAME', value }` o `{ kind: 'IDENTIFIER', identifierType, value, previous }` (`previous: true` es un identificador retirado). Hay `exactMatch` cuando todas las coincidencias exactas son del mismo animal; si son de animales distintos, `exactMatch` es `null` y cada uno aparece en `items` con `exact: true` y su porqué. La búsqueda difusa (`pg_trgm`) solo corre si no hubo ninguna coincidencia exacta, y desde 2 caracteres. No incluye archivados; sí los que salieron, con su `status`.
- `GET /animals/:id`: `economics: { purchasePrice }` solo existe en la respuesta de ADMIN. `POST /animals` y `PATCH /animals/:id` responden la ficha con `warnings`.
- `POST /animals/bulk/tags` y `/bulk/lot` son todo o nada: si un animal no es de la finca (404), está archivado (`ANIMAL_ARCHIVED`) o salió (`ANIMAL_EXITED`), no se cambia ninguno. `add` y `remove` son ids de etiquetas manuales. Respuestas: `{ updated }` y `{ moved, unchanged }`.
- `GET /animals/:id/timeline` → `{ items: [{ key, kind, date, voided, data }], nextCursor }`, del más reciente al más antiguo; los eventos anulados vienen con `voided: true`. No incluye datos económicos.

**Detalles de M4d** (exportación, QR y etiquetas).
- `GET /animals/export.xlsx`: hoja «Animales» con encabezados en español y fila fija: código, nombre, sexo, raza, fecha de nacimiento, nacimiento aproximado, edad (texto y meses), categoría, etiquetas, partos, parto estimado, lote, último peso (kg) y su fecha, alertas, chapeta, DIN, RFID, madre, procedencia, fecha de ingreso, estado, fecha de salida y, solo para ADMIN, valor de compra (RN-20: para los demás la columna no existe y ni se consulta). Fechas como fechas de Excel y números como números; los textos que empiezan por `=`, `+`, `-`, `@`, tabulador o retorno llevan un apóstrofo delante. Hasta 50.000 filas.
- El QR codifica `${PUBLIC_WEB_URL}/a/<id>` y nada más (IDN-03 CA3). La ficha trae `qrUrl`; la web dibuja el QR en SVG. Reemplaza a `GET /animals/:id/qr` y `POST /animals/qr-sheet` (PDF), que no se implementan: la hoja se imprime desde el navegador y el PDF es de M19.
- `GET /animals/search?q=` reconoce el contenido de un QR del sistema: `exactMatch.via = { kind: 'QR', value: <id> }` si el animal es de la finca.
- La ficha trae además `entryDateEstimated` (la importación tomó la de nacimiento; deja de serlo al corregir la fecha con `PATCH`) y `reproduction.importedPriorCalvings` (RN-29).

**Detalles de M4c** (salida, archivo, numeración reutilizable y auditoría).
- `exit`, `revert-exit`, `archive` y `restore` son solo de ADMIN, bloquean la fila del animal y responden 201 con la ficha y `warnings`. Un OPERATOR o VET recibe `FORBIDDEN_ROLE`; un animal de otra finca, 404.
- `exit`: venta sin `sale.amount` → `SALE_AMOUNT_REQUIRED` (422, con el campo `sale.amount` marcado); `sale` en una salida que no es venta → `VALIDATION_FAILED`. Venta o sacrificio con retiro vigente hasta la fecha de salida → `WITHDRAWAL_ACTIVE` (con `context.withdrawalUntil`) si no llega `confirmWithdrawal: true`; la confirmación queda en la auditoría (RN-22). Una venta crea su `Sale`. Animal que ya salió → `ANIMAL_EXITED`; archivado → `ANIMAL_ARCHIVED`. La fecha no puede ser futura ni anterior al nacimiento o al ingreso. Quita «Disponible para venta».
- `revert-exit`: anula la venta (`voidedAt`), borra la salida y reactiva las chapetas `EXITED` que sigan libres. Solo el código bloquea: si ya lo tiene otro animal activo y no llega `newCode`, `CODE_REASSIGNED` con ese animal en `context` (`animalId`, `animalCode`); con `newCode`, el código nuevo se verifica igual que al crear (`ANIMAL_CODE_TAKEN`). Cada chapeta `EXITED` que ya tiene otro animal activo queda retirada y llega como advertencia `IDENTIFIER_NOT_RESTORED`, haya o no `newCode` (M4d). Un animal sin salida → `VALIDATION_FAILED`.
- `archive` `{ reason }` (3 a 500 caracteres) retira todos los identificadores activos con motivo `ARCHIVED` (ANI-03 CA4). `restore` `{ newCode? }`: si el código ya lo tiene otro animal en el conjunto donde la finca exige unicidad, `ANIMAL_CODE_TAKEN` con ese animal en `context`; reactiva los identificadores `ARCHIVED` libres y avisa de los demás con `IDENTIFIER_NOT_RESTORED`. Los archivados se listan con `GET /animals?status=archived` (solo ADMIN).
- El código se compara normalizado (RN-30): «5», «05» y « 005 » son el mismo. Registro, edición, reversión y restauración usan la misma verificación, con un candado por código dentro de la transacción: dos registros simultáneos del mismo código dan un 201 y un 409, nunca un 500. `ANIMAL_CODE_TAKEN` lleva el animal que lo tiene en `context`.
- La ficha trae `codeHistory` y `archive: { archivedAt, reason } | null`.
- Una chapeta liberada con `EXITED` se asigna a otro animal sin `confirmReuse` (IDN-06 CA1). `retire` y `replace` de identificadores solo aceptan los motivos `LOST`, `DAMAGED`, `REASSIGNED` y `OTHER`: `EXITED` y `ARCHIVED` los pone el sistema.

**Cambios de la validación con ganaderos.**
- M4c, numeración reutilizable (ANI-10, ANI-11, IDN-06):
  - `GET /animals/next-code` con `codeSuggestion = LOWEST_FREE` devuelve el menor entero libre en el conjunto donde se exige la unicidad: los activos si `codeReuse = true`, los no archivados si no (ANI-10 CA2).
  - La búsqueda exacta de un código (normalizado) devuelve el animal **activo** que lo tiene: si alguna coincidencia exacta es de un activo, se descartan las de los que salieron. Si ninguna, la del que lo tuvo y salió, con su `status`.
  - La ficha trae `codeHistory`: `previousHolder` (quién tuvo antes este número y cuándo salió) o, si el animal salió, `currentHolder` (quién lo tiene hoy), con `{ animalId, code, status, exitDate }` para enlazar.
  - `POST /animals/:id/exit` en una finca con `codeReuse` retira las chapetas con motivo `EXITED`; DIN y RFID siguen del animal (RN-32).
  - `POST /animals/:id/revert-exit` responde `CODE_REASSIGNED` (con el animal que lo tiene en `context`) si su código ya lo tiene otro animal activo; se reintenta con `{ newCode }`. Una chapeta ocupada no bloquea: queda retirada con `IDENTIFIER_NOT_RESTORED`.
- M5, reproducción (RN-39): el filtro `alerts` acepta `calving_overdue` (parto vencido sin registrar). La ficha trae en `reproduction` la preñez abierta completa (`openPregnancy`, con días de gestación, toro, quién palpó y si el parto estimado se corrigió a mano), `calvingInterval: { lastDays, averageDays }` (RN-38) e `history` con todas las preñeces, anuladas incluidas.
- M5: `PATCH /breeds/:id`, `PATCH /farm` y `PATCH /animals/:id` pueden traer la advertencia `EXPECTED_CALVING_RECALCULATED` cuando el cambio recalculó el parto estimado de preñeces abiertas (RN-04).
- M6, pesos (PES-05): el filtro `alerts` de `GET /animals` acepta además `low_gain` (ganancia baja) y `weight_loss` (perdió peso). Desde M6 todas las alertas del filtro, también las de vacunas, se resuelven en SQL (ADR-009 decisión 8).
- M6: la palpación (`POST /pregnancies/:id/diagnosis`) acepta `notes`, y la preñez confirmada sin servicio, `diagnosisNotes`; la vista de la preñez trae `diagnosisNotes`.
- M9b, leche (LEC-02, LEC-03): `tags` acepta `LACTATING` y `DRIED_OFF`, y `alerts` acepta `dry_off_soon` (secar pronto). La ficha trae `lactation: { daysInMilk, startedOn } | null` en las vacas.

## Identificadores
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | /animals/:id/identifiers | T | Agregar `{ type, value, assignedAt?, confirmReuse? }` (`confirmReuse` solo ADMIN, RN-19) |
| POST | /identifiers/:id/replace | T | `{ reason, newValue, date, confirmReuse? }` (IDN-02) → `{ id, previous, current, warnings }` |
| POST | /identifiers/:id/retire | T | `{ reason, date }` |

## Reproducción
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | /pregnancies | T | Filtros: `outcome, confirmed, expectedFrom, expectedTo, damId`; paginado, de la más reciente a la más antigua. No trae anuladas |
| GET | /pregnancies/:id | T | Una preñez (`PregnancyView`) |
| POST | /pregnancies | T | Servicio (REP-01): `{ id?, damId, serviceDate, method, sireId? | sireExternalRef?, responsible?, notes? }`, o preñez confirmada sin servicio (REP-02 CA3): `{ id?, damId, gestationMonths, diagnosisDate, diagnosisResponsible?, diagnosisResponsibleUserId? }` → `PregnancyView` con `warnings` |
| POST | /pregnancies/:id/diagnosis | T | `{ date, result: POSITIVE|NEGATIVE, responsible?, responsibleUserId? }`. `Idempotency-Key` |
| POST | /pregnancies/:id/abortion | T | `{ date, notes? }`. `Idempotency-Key` |
| POST | /calvings | T | REP-04: `{ id?, damId, pregnancyId?, date, calvingType, notes?, calves: [{ id?, code?, sex, birthWeightKg?, health: ALIVE|WEAK|STILLBORN, breedId?, identifiers? }] }` → `{ pregnancy, calves, warnings }`. `Idempotency-Key` |
| PATCH | /pregnancies/:id | T | `{ version, serviceDate?, method?, sireId?, sireExternalRef?, expectedCalvingDate?, responsible?, notes? }` |
| POST | /pregnancies/:id/void | A | `{ reason }`. `Idempotency-Key` |

**Detalles de M5.**
- Todas las acciones exigen una hembra de la finca (`SEX_NOT_ALLOWED`), activa (`ANIMAL_EXITED`, `ANIMAL_ARCHIVED`) y fechas que no sean futuras (`DATE_IN_FUTURE`) ni anteriores al nacimiento (`DATE_BEFORE_BIRTH`). Una hembra de otra finca en el cuerpo responde `VALIDATION_FAILED` en `damId`; una preñez de otra finca, 404.
- Servicio: con una preñez abierta, `PREGNANCY_ALREADY_OPEN` (409) con `context.pregnancyId`; debe ser posterior al último parto o aborto; el toro de la finca debe ser macho; advertencia `BREEDING_AGE_LOW` (RN-15).
- Palpación, aborto y parto: la preñez debe estar abierta (`PREGNANCY_NOT_OPEN`) y la fecha no puede ser anterior al servicio. Positiva conserva la primera confirmación; negativa cierra con `FAILED`.
- Parto: sin `pregnancyId` cierra la preñez abierta de la hembra o, si no hay, crea una ya cerrada con servicio estimado (parto − gestación, `method = UNKNOWN`). Las crías sin `code` reciben el de la sugerencia de la finca dentro de la transacción, bajo un candado por finca; todos los códigos pasan por `assertCodeAvailable` y los identificadores por `checkIdentifier`, con el error en el campo de la cría (`calves.1.code`, `calves.0.identifiers.0.value`). Una cría `STILLBORN` no lleva `id`, `code`, `breedId` ni identificadores: suma a `stillbornCount`. Las crías vivas: madre, padre de la preñez, raza de la madre salvo `breedId`, lote de la madre, `birthCondition` (`HEALTHY` o `WEAK`) y el peso como primer pesaje. `DAM_AGE_LOW` si la madre era menor que la edad mínima (RN-23). Todo o nada.
- Sin `Idempotency-Key`, un parto repetido con los mismos `id` (de la preñez creada o de las crías) responde 200 con el mismo parto; si esos `id` son de otra hembra, otra fecha u otra preñez, `CLIENT_ID_CONFLICT`.
- `PATCH`: las fechas solo mientras la preñez está abierta. Cambiar `serviceDate` recalcula el parto estimado y quita la marca de corrección a mano; enviar `expectedCalvingDate` lo deja marcado (`expectedCalvingManual`).
- Anular: lo ya anulado responde 200 con el estado actual. Un parto con crías vivas que siguen en la finca responde `PREGNANCY_HAS_CALVES` (409) con sus códigos en el mensaje; las que salieron o están archivadas no bloquean.

## Sanidad
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | /vaccinations | T | Filtros: `animalId, vaccineId, from, to` |
| POST | /vaccinations | T | Individual (SAN-02): `{ id?, animalId, vaccineId, date, dose?, batchNumber?, ruvNumber?, responsible?, nextDueOn?, notes? }` → vista con `warnings` |
| POST | /vaccinations/bulk | T | `{ vaccineId, date, dose?, responsible?, batchNumber?, ruvNumber?, notes?, animalIds | filter, excludeIds? }` → `{ dryRun, selected, toApply, created, skipped: [{ animal, reason }], warnings, cycle }`. `?dryRun=true` no guarda. `Idempotency-Key` |
| POST | /vaccinations/:id/void | A/V | Anular |
| GET/POST | /treatments | T | Tratamientos (SAN-05); `cost` solo A (crea un gasto `MEDICATION` directo) |
| POST | /treatments/:id/void | A/V | Anular (también su gasto). `Idempotency-Key` |
| GET | /alerts | T | Página de Alertas (M6): `types` (alertas de `ANIMAL_ALERT`, combinadas con «o»), `lotId`, `limit`, `cursor` → `{ counts, items, nextCursor, total }`. Reemplaza a `GET /vaccinations/due` |

**Detalles de M6 (sanidad).**
- Vacunación individual: `id` del cliente; el animal debe estar activo; fecha no futura ni anterior al nacimiento (RN-14); vacuna activa de la finca. Sexo no elegible con bloqueo → `VACCINE_SEX_BLOCKED` (RN-26); fuera de la edad recomendada → advertencia `VACCINE_AGE_OUTSIDE_WINDOW`. `nextDueOn` solo en vacunas `INTERVAL`: sin valor se propone con el intervalo (RN-12), `null` es «sin próxima fecha» y debe ser posterior a la aplicación; en otra vacuna → `VALIDATION_FAILED`. Una vacuna de ciclo oficial queda con el `cycleId` del ciclo activo que la incluye y contiene la fecha. Sin dosis, la de la vacuna.
- Vacunación por lote: `filter` son los filtros de `GET /animals` (como cadenas), hasta 5.000 animales; ids de otra finca → 404. Motivos de `skipped`: `NOT_ACTIVE`, `SEX_BLOCKED`, `BEFORE_BIRTH_OR_ENTRY`, `ALREADY_IN_CYCLE`, `ALREADY_ON_DATE`. La confirmación bloquea las filas de los animales y vuelve a decidir con los datos de ese momento, en una transacción.
- Tratamiento: `durationDays` (1 a 365, 1 por defecto), `withdrawalMeatDays` y `withdrawalMilkDays` (0 a 365). La vista trae `meatWithdrawalUntil`, `milkWithdrawalUntil` y `withdrawalUntil` (el más lejano); `cost` solo en la respuesta de ADMIN. Un `cost` enviado por OPERATOR o VET → `FORBIDDEN_ROLE`.
- La ficha (`GET /animals/:id`) trae además `withdrawals: { meatUntil, milkUntil }` y `weight` (ganancias y alertas de peso; `null` si el animal no está activo). La salida por venta o sacrificio pide confirmar solo con retiro de **carne** vigente (RN-22).
- Alertas: `counts` trae todas las alertas con el filtro de lote (no el de tipo); cada fila es la del listado más `vaccines` (vencidas, pendientes o próximas), `withdrawals`, `pregnancy` y `weight`, ordenadas por código.

## Pesos y lotes
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | /animals/:id/weights | T | Serie y ganancia diaria: entre los dos últimos pesajes, en los últimos 90 días y desde el nacimiento (PES-02, PES-05), y fecha estimada para el peso objetivo de venta (PES-06, M8) |
| POST | /weights | T | `{ id?, animalId, date, weightKg, method, identifiedBy?: SEARCH|RFID_READER|QR, notes? }` → vista con `warnings` (`WEIGHT_OUTLIER` si difiere más del 30 %). El peso digitado es `weightSource = MANUAL`; sin `identifiedBy`, `SEARCH`. `scaleSerial` llega con el pesaje en vivo (PES-03 CA6, M15) por la sincronización |
| POST | /weights/:id/void | T (propio, 24 h) / A | Anular. Fuera de eso, `FORBIDDEN_ROLE` («Pídeselo al administrador»). `Idempotency-Key` |
| GET | /scale-profiles | T | Plantillas del sistema y perfiles de la finca, juntos: `{ items: [{ id, name, system, templateKey?, version, provisional, fileFormat, columnMapping }] }`. `system: true` marca las plantillas del sistema (la primera, **Tru-Test**, provisional), que viven en `packages/shared` y no se editan (PES-04, M6; 09 v1.4) |
| POST/PATCH | /scale-profiles, /scale-profiles/:id | A | Crear o editar un perfil de la finca. Una plantilla del sistema no se edita: `SYSTEM_TEMPLATE_READONLY` (409) |
| POST | /scale-profiles/:templateKey/duplicate | A | Duplica una plantilla del sistema como perfil propio de la finca, editable, con `sourceTemplateKey` y `sourceTemplateVersion`. Quien no duplica recibe las correcciones de la plantilla (nueva `version`) sin hacer nada |
| POST | /weights/import?dryRun=true | T | `multipart/form-data` con `file` y `scaleProfileId` (id de un perfil de la finca o `key` de una plantilla, como `tru-test`) o `mapping` (JSON); sin ninguno, la API propone el mapeo por los encabezados. Además `sessionDate` (archivos sin fecha), `associations` (JSON `[{ chip, animalId, saveChip }]`) y `skip` (chips separados por coma) → `{ fileName, totalRows, profile, mapping, columns, unit, rows, counts, unknownChips, warnings, importable, chipNotices, previousImport }`. No guarda nada |
| POST | /weights/import | T | Lo mismo más `importKey` (UUID, obligatorio) y `expectedRows` → 201 `{ importBatchId, workSessionId, created, skipped, chipsSaved, replayed: false }`; con una `importKey` ya usada, 200 con `replayed: true` |

**Detalles de M6 (pesos y báscula).**
- `GET /animals/:id/weights` → `{ items, summary: { gains: { lastTwo, last90Days, sinceBirth }, gainThreshold, lowGain, weightLoss, lossPercent } }`, la serie de la más antigua a la más reciente y las ganancias en kg/día redondeadas a milésimas (ADR-015).
- Importación (ADR-011, sección de la báscula): cada fila trae `status` (`MATCHED`, `DUPLICATE`, `UNKNOWN_CHIP`, `SKIPPED`, `ERROR`) y `via` (`RFID`, `VISUAL_TAG`, `CODE`, `ASSOCIATED`). Se asocia por chip activo, luego por chapeta visual activa y luego por código interno normalizado (RN-30), solo animales activos. El mismo animal el mismo día: se guarda la última fila y se avisa con `SCALE_DUPLICATE_READING`. Atípico: más del 30 % frente al pesaje anterior, de la base o del mismo archivo. Un chip asociado con `saveChip` se guarda como RFID del animal si pasa `checkIdentifier`; si el animal ya tiene otro chip, o el chip no se puede asignar, va en `chipNotices` y no se guarda. Al confirmar se crea una `WorkSession` `WEIGHT` cerrada y un pesaje por animal con `method = SCALE`, `identifiedBy = IMPORT` y `weightSource = SCALE_FILE`. Sin columna de peso, o sin chip ni número visual → `SCALE_FILE_INVALID`; un perfil de otra finca → `VALIDATION_FAILED` en `scaleProfileId`.
- Libras: con `unit = LB` el peso se convierte a kilos con redondeo a 0,1 kg; la fila trae también `originalWeight`.
- **Plantilla Tru-Test (provisional).** Encabezados aceptados: chip `EID`, `Electronic ID`, `RFID`, `Chip`; número `VID`, `Visual ID`, `ID visual`; peso `Weight`, `Weight (kg)`, `Peso`; fecha `Date`, `Fecha` (con la hora pegada o no); hora `Time`, `Hora`; fecha dd/mm/aaaa; kilos. **Hay que confirmar con un archivo real de la finca piloto:** los encabezados exactos y su idioma (el indicador se puede configurar en español); si el archivo trae filas de metadatos de la sesión antes de la tabla (hoy la primera fila debe ser la de encabezados); el formato de la fecha (depende de la configuración regional del indicador) y si la hora va aparte; el separador y el decimal del CSV; la unidad (kg o lb); si el EID viene con espacios o puntos («982 000123456789»; hoy se quitan); la codificación; y las columnas extra (Draft, Note, número de serie del indicador, que alimentaría `scale_serial`).
- `/scale-profiles`: un nombre repetido (sin distinguir mayúsculas) → `CATALOG_NAME_TAKEN`; `PATCH` con `version`.

## Leche (M9b, alcance extendido)
Solo existe con `productionSystem` `LECHERIA` o `DOBLE_PROPOSITO` (CFG-03 CA2); en otra finca responde 404.

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | /milk-records | T | Filtros: `animalId, lotId, from, to` |
| POST | /milk-records | T | `{ animalId, date, milking: AM|PM|TOTAL, liters, method: METER|ESTIMATE }` (LEC-01). `NOT_LACTATING` si la vaca no está en ordeño; con retiro de leche vigente se guarda con `unfitForSale: true` y la advertencia `MILK_UNFIT_FOR_SALE`. Un segundo registro del mismo ordeño anula el anterior (RN-36) |
| POST | /milk-records/bulk | T | Jornada de ordeño: `{ date, milking, method, workSessionId?, items: [{ animalId, liters }] }` → en una transacción (LEC-01 CA2) |
| POST | /milk-records/:id/void | T (propio, 24 h) / A | Anular |
| POST | /dry-offs | T | `{ animalId, date, reason, notes? }` (LEC-03) |
| POST | /dry-offs/:id/void | A/V | Anular |
| GET | /animals/:id/lactations | T | Lactancias con curva, acumulado, promedio diario y pico (LEC-04); la cerrada por un parto nuevo lo indica (RN-37) |
| GET | /reports/milk?from&to&lotId | T | Producción diaria y mensual, por lote, ranking de vacas y vacas bajo el umbral (LEC-05), exportable |

## Finanzas (solo ADMIN)
Todas las rutas responden 403 a OPERATOR y VET (RN-20, comprobado por rol en el controlador). Un registro de otra finca es 404.

| Método | Ruta | Descripción |
|---|---|---|
| GET | /expenses | Filtros: `type, from, to, animalId, lotId, q` (descripción), `voided=true` (incluye los anulados); de la fecha más reciente a la más antigua, paginado |
| GET | /expenses/:id | El gasto con sus asignaciones vigentes, ordenadas por animal (ADR-016) |
| POST | /expenses | `{ id?, type, date, amount, description, allocation: { method: DIRECT, animalId } \| { method: EQUAL\|BY_WEIGHT, lotId \| animalIds } \| { method: GENERAL }, dryRun? }` (M7) |
| PATCH | /expenses/:id | Corregir, con `version`: `{ version, type?, date?, amount?, description?, allocation? }` (ADR-016) |
| POST | /expenses/:id/void | Anular el gasto y sus asignaciones. `Idempotency-Key`; anular dos veces responde 200 |
| GET | /sales?from&to | Ventas vigentes, de la más reciente a la más antigua (M7) |
| PATCH | /sales/:id | Corregir precio, comprador u observaciones, con `version` (M7) |
| POST | /valuations | `{ id?, animalId, date, method: MANUAL, amount }` o `{ id?, animalId, date, method: PRICE_PER_KG }` |
| POST | /valuations/:id/void | Anular un avalúo. `Idempotency-Key` (M7) |
| GET | /animals/:id/finance | Inversión, desglose, avalúo, venta, resultado |
| GET | /finance/summary?from&to | ECO-06 |
| GET | /finance/summary/export.xlsx?from&to | ECO-06 en Excel (M7) |

**Detalles de M7.**
- `POST /expenses`: el tipo `PURCHASE` no se registra como gasto suelto (`EXPENSE_PURCHASE_FROM_ANIMAL`): va en el formulario del animal. La fecha no puede ser futura. `DIRECT` carga todo a `animalId`; `EQUAL` o `BY_WEIGHT` reparten entre los animales activos de `lotId` (al guardar) o entre `animalIds` (la selección del listado, hasta 5.000); `GENERAL` no se carga a animales. Un animal de otra finca, archivado o que salió antes de la fecha del gasto → `VALIDATION_FAILED` con los códigos en el campo. Un lote sin animales activos → `ALLOCATION_EMPTY`. `BY_WEIGHT` usa el último pesaje vigente de cada animal hasta la fecha del gasto; si falta alguno, `ALLOCATION_NO_WEIGHT` con los códigos en `detail`. Con `dryRun: true` responde 200 con `{ dryRun: true, amount, method, allocations }` sin guardar. El reparto lo hace `allocateExpense`: animales ordenados por id, pesos enteros y el residuo al primero (RN-17, ADR-016).
- Respuesta de un gasto: `{ id, type, date, amount, description, method, lot, animalCount, animal (el del directo), treatmentId, voided, voidReason, version, createdBy, allocations: [{ animal, amount }] }`.
- `PATCH /expenses/:id`: lo que no llega no cambia. Sin `allocation`, el reparto se vuelve a calcular solo si cambió el monto o la fecha, con los mismos animales; corregir solo la descripción o el tipo no toca ninguna asignación. Si el reparto cambia, las asignaciones vigentes quedan anuladas y se crean las nuevas. El gasto de un tratamiento o una compra no cambia de animal (`VALIDATION_FAILED` en `allocation`) y la compra no deja de ser compra. Un gasto anulado → `EXPENSE_VOIDED`.
- `PATCH /sales/:id`: la fecha es la de la salida y no se cambia aquí (se revierte la salida). Una venta anulada por revertir la salida → `SALE_VOIDED`.
- `POST /valuations` con `PRICE_PER_KG`: el último pesaje hasta la fecha × `settings.pricePerKgByCategory` de la categoría actual del animal, en pesos enteros. Sin precio para la categoría → `VALUATION_NO_PRICE`; sin pesajes → `VALUATION_NO_WEIGHT`. Un avalúo no se edita: se anula y se registra otro.
- `GET /animals/:id/finance` → `{ animalId, investment: { total, byType }, lines: [{ expenseId, date, type, description, method, amount, expenseAmount, animalCount, lot }], valuations, sale, result: { basis: SALE|VALUATION, amount } | null }`. Inversión = asignaciones vigentes de gastos vigentes, compra incluida (RN-18); resultado = venta − inversión o, sin venta, último avalúo − inversión.
- `GET /finance/summary` (sin fechas, del 1.º de enero a hoy) → `{ from, to, herd: { animals, investment, byCategory: [{ category, animals, investment }] }, expenses: { total, allocated, general, byType, byMonth: [{ month: YYYY-MM, amount }] }, sales: { count, total, investment, result, items: [{ saleId, animal, date, buyer, amount, investment, result }] } }`. La inversión del hato es la acumulada de los animales activos hoy por su categoría actual; los gastos y las ventas, los del período. Los agregados salen de SQL (CTE `investment`, ADR-016).
- `GET /finance/summary/export.xlsx`: hojas «Resumen», «Inversión por categoría», «Gastos por tipo», «Gastos por mes» y «Ventas», con encabezados en español y fila fija, fechas como fechas de Excel, montos como números y los textos de la finca (comprador, nombre) con el apóstrofo delante si empiezan por `=`, `+`, `-`, `@`, tabulador o retorno (M4d).
- `GET /farm` sigue mandando `settings.pricePerKgByCategory` solo al ADMIN; desde M7 el `PATCH /farm` lo valida: claves de categoría de manejo y montos positivos.

## Jornadas
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET/POST | /work-sessions | T | Listar / crear |
| GET | /work-sessions/:id | T | Detalle con progreso |
| POST | /work-sessions/:id/entries | T | `{ animalId, data: { vaccination?, weight?, diagnosis?, treatment?, lotId?, tags? } }` → crea eventos en transacción |
| POST | /work-sessions/:id/close | T | Cierra y devuelve resumen |

## Tablero y reportes
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | /dashboard | T | Indicadores RPT-01 (económicos solo A). Desde M8 agrega las preguntas del sistema productivo de la finca (CFG-03): destete e intervalo entre partos en cría, peso de venta y ganancia en ceba (PES-05, PES-06), vacas en ordeño, secas, leche de ayer y del mes, secar pronto y retiro de leche en lechería y doble propósito. Contrato de M8a abajo |
| GET | /reports/inventory | T | Por sexo, categoría de manejo, raza, lote |
| GET | /reports/inventory-ica | T | Grupos de edad y sexo en formato ICA |
| GET | /reports/births?from&to | T | NAC-01 (M5): `{ from, to, totals: { live, males, females, weak, stillborn }, items: [{ calf, birthDate, dam, sire, sireExternalRef, breed, birthWeightKg, birthCondition }], stillbirths: [{ pregnancyId, date, dam, count }] }`. Sin fechas, del 1.º de enero a hoy. Cuenta los nacidos en la finca en el período aunque ya hayan salido; no los archivados |
| GET | /reports/vaccinations?from&to&vaccineId | T | Vacunados |
| GET | /reports/calvings-upcoming | T | Partos próximos |
| GET | /reports/exits?from&to&type | T | Vendidos o retirados |
| GET | /reports/:name/export?format=xlsx | T (económicos A) | Exportación |
| GET | /animals/:id/report.pdf | T | Ficha individual en PDF |
| GET | /export/full | A | Exportación completa (BAK-02) |

**`GET /dashboard` (M8a, `DashboardResponse` de shared).** Todas las cifras salen de SQL en una pasada de la clasificación sobre los activos (ADR-009, ADR-017) y coinciden con el total del listado o de Alertas al que enlaza la web. Siempre trae:
- `today`, `productionSystem`, `salesFocus` y `questions` (las preguntas propias del sistema, en orden: `WEANING`, `CALVING_INTERVAL`, `DRY_COWS`, `MILK_WITHDRAWAL`, `SALE_WEIGHT`, `LOW_GAIN_LOTS`, `DAYS_TO_SALE`);
- `herd: { total, males, females, calvesMale, calvesFemale }`;
- `reproduction: { pregnant, served, calvingSoon, calvingOverdue, nextCalving: { animalId, code, expectedCalvingDate } | null }` (la próxima es la primera de `alerts=calving_soon&sort=calving`);
- `births: { from, to, live, males, females }`, con el criterio del reporte de nacimientos, del 1.º de enero a hoy;
- `vaccines: { pending, overdue, due, currentCycle: { id, name } | null }`: `pending` cuenta cada animal una vez (lo mismo que Alertas con `types=vaccine_overdue,vaccine_due`); `currentCycle` es el ciclo oficial en curso hoy, para su avance (`GET /vaccination-cycles/:id/progress`);
- `alerts`: animales activos por tipo de alerta, como los conteos de `GET /alerts`;
- `forSale: { count, sex }`: marcados «Disponible para venta», del sexo de `salesFocus` si lo hay;
- `investment` (cadena decimal): inversión del hato activo (RN-18), **solo para ADMIN**; para los demás la clave no existe ni se consulta (RN-20).

Y solo las secciones de `questions`: `weaning: { bornFrom, bornTo, count, weighed, averageWeightKg }`, `calvingInterval: { count, females, averageDays, distribution: [{ bucket, count }] }` (RN-38), `dryCows: { count }`, `milkWithdrawal: { count }`, `saleWeight: { monthEnd, reached, thisMonth, likelyReached, later }`, `lotGains: { belowThreshold, others }` (cada lote: `{ lotId, name, animals, averageGain, averageThreshold, lowGain }`, en kg/día) y `daysToSale: { averageDays, animals }` (de los que tienen fecha estimada hoy o después). Cambiar el sistema productivo cambia las secciones, nunca las cifras comunes (CFG-03 CA1). Medido con el seed de carga (5.000 animales y 50.000 eventos): p95 de 887 ms.

## Auditoría
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | /audit?animalId&entity&entityId&from&to&limit&cursor | A | Consulta paginada, de la más reciente a la más antigua |

- `animalId` trae el animal, sus identificadores y, desde M7, sus eventos de M5 y M6: preñeces (como madre; un parto es un cambio de la preñez), vacunaciones, tratamientos y pesajes (pestaña «Cambios» de la ficha); no se combina con `entity`. `entityId` exige `entity`. `entity`: `Animal`, `Identifier`, `Breed`, `Lot`, `Tag`, `Vaccine`, `VaccinationCycle`, `Farm`, `User` y, desde M7, `Pregnancy`, `VaccinationRecord`, `TreatmentRecord`, `WeightRecord`, `ScaleProfile` e `ImportBatch`. `from` y `to` son días en la zona de la finca, ambos incluidos.
- Respuesta `{ items, nextCursor }`; cada elemento: `{ id, at, action, entity, entityId, entityLabel, entityDate, animalCode, user: { id, name } | null, changes: [{ field, before, after }] }`. `entityLabel` es el código del animal, el valor del identificador o el nombre del registro; en los eventos, la vacuna, el medicamento, los kilos del pesaje, el perfil de báscula o el archivo importado (`null` en una preñez). `entityDate` es la fecha de negocio del evento (aplicación, inicio, pesaje o servicio) y `animalCode`, el animal del evento; ambos `null` cuando no aplican. Los ids de vacuna y ciclo también llegan como nombre. En `changes`, los ids de raza, lote, madre, padre y etiquetas llegan como nombre o código.
- Desde M7 (ADR-016) trae montos: la ruta es solo del ADMIN, que los ve en todas partes (RN-20). Reemplaza la decisión de M4c, que descartaba los campos con montos. `entity` admite también `Expense`, `Sale` y `Valuation`; con `animalId` vienen además su venta y los gastos en los que tuvo parte (no sus avalúos). El reparto de un gasto llega como `share` (la parte del animal, antes y después) en la consulta por animal y como `animalCount` en las demás. No consulta los inicios de sesión. Un cambio de contraseña aparece como `password` sin valores.

## Sincronización (F2)
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | /sync/pull?since= | T | Cambios desde el cursor |
| POST | /sync/push | T | Lote de operaciones idempotentes |

## Importación (ANI-09, solo ADMIN)
| Método | Ruta | Descripción |
|---|---|---|
| GET | /imports/animals/template | Descarga la plantilla `.xlsx`: hoja de instrucciones, hoja «Animales» y hoja «Listas» con las razas y los lotes activos de la finca |
| POST | /imports/animals?dryRun=true | Simulación (CA3): `multipart/form-data` con `file` y los campos `createMissingBreeds` (`true`/`false`) y `skipRows` («5,9») → `{ fileName, totalRows, validRows, warningRows, errorRows, importable, issues: [{ row, column, severity, message }], newBreeds, previousImport }`. No guarda nada. 200 |
| POST | /imports/animals | Confirmación (CA5): el mismo archivo y campos, más `importKey` (UUID, obligatorio) y `expectedRows` (opcional) → 201 `{ importBatchId, created, skipped, replayed: false }`. Con una `importKey` ya usada, 200 con el lote de antes y `replayed: true` |
| POST | /imports/animals/errors | El mismo archivo → `.xlsx` con las filas que tienen error, sus valores originales y una columna «Error» (CA5) |

**Detalles (M4d, ADR-011).**
- Archivo: `.xlsx` o `.csv` (UTF-8 o Windows-1252; separador `;`, `,` o tabulador), hasta 5 MB (`IMPORT_FILE_TOO_LARGE`, 413) y 5.000 filas (`IMPORT_TOO_MANY_ROWS`, 413). Se comprueba el tipo real: un `.xlsx` que no es un ZIP de hoja de cálculo, un `.csv` binario, un libro con macros (`.xlsm`, aunque se renombre) o un ZIP que se infla por encima del límite o trae rutas que salen de la carpeta responden `IMPORT_FILE_INVALID` (422) con el motivo en `detail`. Faltan columnas obligatorias → `IMPORT_FILE_INVALID` con cuáles.
- De las fórmulas se usa el valor guardado; una fórmula sin valor guardado es un error de la fila.
- Cada problema trae su fila (como la ve la persona en Excel), su columna (`code`, `dam`, `rfid`…, o `null` si es de la fila) y el mensaje en español. Las filas con advertencias también se importan, salvo que vengan en `skipRows`.
- La confirmación vuelve a validar todo dentro de una transacción de hasta 60 s y escribe todas las filas elegidas o ninguna. Un candado por finca serializa las importaciones. Si `expectedRows` no coincide con lo que entraría, `VERSION_CONFLICT` (409) y no se importa nada.
- Queda en `import_batches` (con `idempotency_key` y `file_sha256`) y en la auditoría: una entrada `IMPORT` del lote y una `CREATE` por animal con el archivo y la fila.

## Catálogo de códigos de error
Definido en `packages/shared/src/errors.ts` como constante; el `detail` en español es el mensaje por defecto (la UI puede usarlo tal cual). Estado HTTP entre paréntesis.

| Código | HTTP | Mensaje por defecto |
|---|---|---|
| `VALIDATION_FAILED` | 422 | Revisa los campos marcados. (con `errors` por campo) |
| `AUTH_INVALID_CREDENTIALS` | 401 | Usuario o contraseña incorrectos. |
| `AUTH_ACCOUNT_LOCKED` | 423 | La cuenta está bloqueada por intentos fallidos. Intenta de nuevo en 15 minutos. |
| `AUTH_PASSWORD_CHANGE_REQUIRED` | 403 | Debes cambiar tu contraseña temporal. |
| `AUTH_TOKEN_EXPIRED` | 401 | La sesión expiró. Vuelve a iniciar sesión. |
| `AUTH_SESSION_MAX_AGE` | 401 | Por seguridad, vuelve a escribir tu contraseña. (tope de la sesión deslizante, AUT-10 CA2; solo para un token legítimo vencido por el tope, con `context.login`) |
| `FORBIDDEN_ROLE` | 403 | Tu rol no permite esta acción. |
| `NOT_FOUND` | 404 | El registro no existe o no pertenece a esta finca. |
| `VERSION_CONFLICT` | 409 | Otra persona modificó este registro. Recarga para ver los cambios. |
| `USERNAME_TAKEN` | 409 | Ya existe un usuario con ese nombre. |
| `LAST_ADMIN` | 409 | La finca debe tener al menos un administrador activo. |
| `CATALOG_NAME_TAKEN` | 409 | Ya existe {what} con el nombre «{name}». (sin distinguir mayúsculas ni espacios) |
| `SYSTEM_TAG_PROTECTED` | 409 | La etiqueta «{label}» es del sistema: no se puede desactivar ni cambiar su nombre. |
| `ANIMAL_CODE_TAKEN` | 409 | Ya existe un animal con el código {code}. |
| `ANIMAL_EXITED` | 409 | El animal ya salió de la finca; revierte la salida para modificarlo. |
| `ANIMAL_ARCHIVED` | 409 | El animal está archivado. |
| `IDENTIFIER_TAKEN` | 409 | El identificador {value} ya está asignado al animal {code}. |
| `IDENTIFIER_PREVIOUSLY_USED` | 409 | El identificador {value} perteneció al animal {code}. Solo un administrador puede reasignarlo. (RN-19; el ADMIN lo confirma con `confirmReuse: true`) |
| `IDENTIFIER_INVALID_RFID` | 422 | El código RFID debe tener exactamente 15 dígitos. |
| `SEX_NOT_ALLOWED` | 422 | Esta acción solo aplica a hembras. / El padre debe ser macho. |
| `PREGNANCY_ALREADY_OPEN` | 409 | La hembra ya tiene una preñez abierta. |
| `PREGNANCY_NOT_OPEN` | 409 | La hembra no tiene una preñez abierta. |
| `PREGNANCY_HAS_CALVES` | 409 | Archiva primero las crías de este parto. (M5, al anular un parto con crías activas) |
| `DATE_IN_FUTURE` | 422 | La fecha no puede ser posterior a hoy. |
| `DATE_BEFORE_BIRTH` | 422 | La fecha es anterior al nacimiento del animal. |
| `CALVES_COUNT_INVALID` | 422 | Un parto puede registrar de 1 a 3 crías. |
| `VACCINE_SEX_BLOCKED` | 422 | La vacuna {vaccine} no se aplica a {sex}. |
| `WITHDRAWAL_ACTIVE` | 409 | El animal está en retiro hasta {date}. Confirma para continuar. |
| `SALE_AMOUNT_REQUIRED` | 422 | Indica el precio de venta. |
| `ALLOCATION_EMPTY` | 422 | Selecciona al menos un animal para repartir el gasto. |
| `ALLOCATION_NO_WEIGHT` | 422 | Hay animales sin peso registrado; usa reparto en partes iguales. (Desde M7, el `detail` nombra los códigos) |
| `EXPENSE_PURCHASE_FROM_ANIMAL` | 422 | El valor de compra se registra en la ficha del animal, al crearlo o editarlo. (M7) |
| `EXPENSE_VOIDED` | 409 | Este gasto está anulado: registra uno nuevo. (M7) |
| `SALE_VOIDED` | 409 | Esta venta está anulada porque se revirtió la salida del animal. (M7) |
| `VALUATION_NO_PRICE` | 422 | No hay precio por kilo para la categoría {category}. Configúralo en Configuración → Finca. (M7) |
| `VALUATION_NO_WEIGHT` | 422 | El animal no tiene pesajes: registra un peso o pon el valor a mano. (M7) |
| `WORK_SESSION_CLOSED` | 409 | La jornada ya fue cerrada. |
| `IMPORT_FILE_INVALID` | 422 | El archivo no tiene el formato de la plantilla. |
| `IMPORT_TOO_MANY_ROWS` | 413 | El archivo supera las 5.000 filas. |
| `IMPORT_FILE_TOO_LARGE` | 413 | El archivo supera los 5 MB. |
| `CLIENT_ID_CONFLICT` | 409 | Ya existe un registro con ese identificador y otros datos. (ADR-012, desde M5) |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Esa clave de reintento ya se usó para otra operación. (ADR-012, desde M5) |
| `PLAN_LIMIT_REACHED` | 403 | Tu plan no permite más {what}. (ADR-013; **reservado, sin uso en F1**: con el plan PILOT nada lo lanza) |
| `CODE_REASSIGNED` | 409 | El código {code} ya lo tiene el animal activo {holder}. Asígnale un código nuevo para revertir la salida. (IDN-06 CA3, con el animal en `context`) |
| `CODE_REUSE_CONFLICT` | 409 | Hay números repetidos entre animales activos y animales que salieron ({codes}). Cámbialos antes de desactivar la reutilización. (ANI-10 CA3) |
| `SCALE_FILE_INVALID` | 422 | No pudimos leer el archivo de la báscula. Revisa el formato o el perfil de báscula. (PES-04) |
| `SYSTEM_TEMPLATE_READONLY` | 409 | Esta plantilla es del sistema y no se edita. Duplícala para ajustarla a tu báscula. (PES-04) |
| `NOT_LACTATING` | 422 | La vaca {code} no está en ordeño: no tiene un parto sin secado posterior. (LEC-01 CA3) |
| `INVITATION_INVALID` | 410 | La invitación no es válida o ya venció. Pídele al administrador una nueva. |
| `INVITATION_EMAIL_TAKEN` | 409 | {email} ya es usuario de esta finca. |
| `EMAIL_TOKEN_INVALID` | 410 | El enlace ya no es válido o venció. Pide uno nuevo. |
| `EMAIL_NOT_VERIFIED` | 409 | Primero verifica tu correo: te enviamos un enlace. |
| `EMAIL_REQUIRED_FOR_ADMIN` | 422 | Un administrador debe tener correo. |
| `GOOGLE_NO_ACCESS` | 403 | Esta cuenta de Google no tiene acceso a ninguna finca. Pídele al administrador una invitación. |
| `IDENTITY_ALREADY_LINKED` | 409 | Esa cuenta de Google ya está vinculada a otro usuario. |
| `LAST_LOGIN_METHOD` | 409 | No puedes desvincular tu único método de acceso. Crea una contraseña primero. |
| `OAUTH_FLOW_INVALID` | 400 | El inicio con Google se interrumpió o venció. Intenta de nuevo. |
| `RATE_LIMITED` | 429 | Demasiadas solicitudes. Espera un momento. |
| `INTERNAL_ERROR` | 500 | Ocurrió un error inesperado. Ya quedó registrado. |

Las advertencias (no bloqueantes) viajan en la respuesta exitosa como `warnings: [{ code, message }]`: `WEIGHT_OUTLIER`, `RFID_FOREIGN_COUNTRY`, `BREEDING_AGE_LOW`, `DAM_AGE_LOW` (la madre era menor que la edad mínima reproductiva al nacer la cría, RN-23), `VACCINE_AGE_OUTSIDE_WINDOW`, `ALREADY_IN_SESSION`, `CYCLE_OVERLAP` (el ciclo se cruza con otro), `LOT_HAS_ACTIVE_ANIMALS` («12 animales siguen en este lote», al desactivar un lote), `VACCINE_IN_ACTIVE_CYCLE` (al desactivar una vacuna de un ciclo en curso o futuro), `IDENTIFIER_NOT_RESTORED` (al revertir una salida o restaurar un archivado, un identificador que ya tiene otro animal activo quedó retirado; M4c), `SCALE_DUPLICATE_READING` (el mismo animal dos veces el mismo día en el archivo de la báscula: se conserva el último, PES-04), `MILK_UNFIT_FOR_SALE` (leche de una vaca con retiro de leche vigente, LEC-01 CA4), `EXPECTED_CALVING_RECALCULATED` (M5: «Se recalculó el parto estimado de N preñeces abiertas», con las omitidas por estar corregidas a mano).
