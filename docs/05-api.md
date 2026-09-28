# Contrato de la API REST

Base: `/api/v1`. JSON UTF-8. Autenticación: `Authorization: Bearer <accessToken>` salvo en `/auth/*`.
Los esquemas de entrada y salida se definen con zod en `packages/shared/src/schemas` y son la fuente de verdad; esta tabla es el índice.

## Convenciones
- IDs: UUIDv7 en string. El cliente puede enviar el `id` al crear (idempotencia: repetir la misma petición con el mismo `id` no duplica).
- Fechas de negocio: `YYYY-MM-DD`. Marcas de tiempo: ISO 8601 con zona.
- Dinero: string decimal (`"1250000.00"`). Peso: número con hasta 2 decimales.
- Listados: paginación por cursor `?limit=50&cursor=<opaco>` → `{ items, nextCursor }`. Máximo `limit` 200.
- Filtros por query string; múltiples valores separados por coma (`?tags=PREGNANT,CALVED`).
- Actualizaciones: `PATCH` con `version` obligatoria → 409 `VERSION_CONFLICT` si no coincide.
- Anulación de eventos: `POST /<recurso>/:id/void` con `{ reason }`.
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
| GET | /farm | T | Datos y parámetros. `settings.pricePerKgByCategory` solo viaja para ADMIN (RN-20). Desde M4c, M6, M8 y M9b, `settings` incluye `codeReuse`, `codeSuggestion`, `productionSystem`, `salesFocus`, `dryOffBeforeCalvingDays`, `weightGainAlertKgPerDay`, `weightLossAlertPercent` y `targetSaleWeightKg` (03 §2.1). Cambiar `codeReuse` de `true` a `false` con números repetidos responde `CODE_REUSE_CONFLICT` con los animales en `context` |
| PATCH | /farm | A | Editar datos y `settings` (parciales: se mezclan con los guardados y se valida el resultado). Exige `version` |
| GET/POST/PATCH | /breeds, /breeds/:id | T lee, A escribe | Catálogo de razas |
| GET/POST/PATCH | /vaccines, /vaccines/:id | T lee, A/V escribe | Catálogo de vacunas (incluye `scheduleType` y elegibilidad) |
| GET/POST/PATCH | /vaccination-cycles, /vaccination-cycles/:id | T lee, A escribe | Ciclos oficiales y sus vacunas (SAN-06) |
| GET | /vaccination-cycles/:id/progress | T | Vacunados y pendientes por vacuna del ciclo |
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
| GET | /animals/next-code?birthDate= | T | Siguiente código sugerido según `codeSuggestion`: `calfCodePattern` o el menor número libre (ANI-10) |

**Detalles de M4a.**
- Cada fila trae `expectedCalvingDate`: el parto estimado de la preñez abierta confirmada, o `null` (columna «Parto estimado» de 06 §5.2).
- `GET /animals` responde `{ items, nextCursor, total }`: `total` es el conteo con los filtros aplicados, sin paginar. Filtros: `category` (`CALF_MALE, CALF_FEMALE, HEIFER, COW, YOUNG_MALE, ADULT_MALE`); `tags` recibe etiquetas derivadas (`SERVED, PREGNANT, CALVED, DRY, WITHDRAWAL`) y claves de etiquetas manuales (`COTERO`…) en la misma lista; `alerts` acepta además `unconfirmed_service` (servida sin diagnóstico, RN-08). Varios valores de `category`, `breedId` o `lotId` se combinan con «o»; varios de `tags` o `alerts`, con «y». `status` es `active` por defecto; `archived` solo para ADMIN. `sort`: `code`, `age` (de menor a mayor edad), `lastWeight` y sus inversos con `-`; sin peso, al final. Solo los animales activos tienen alertas.
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
- M6, pesos (PES-05): el filtro `alerts` de `GET /animals` acepta además `low_gain` (ganancia baja) y `weight_loss` (perdió peso).
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
| GET | /pregnancies | T | Filtros: `outcome, confirmed, expectedFrom, expectedTo, damId` |
| POST | /pregnancies | T | Servicio (REP-01) o preñez confirmada sin servicio (`gestationMonths`) |
| POST | /pregnancies/:id/diagnosis | T | `{ date, result: POSITIVE|NEGATIVE, responsible? }` |
| POST | /pregnancies/:id/abortion | T | `{ date, notes? }` |
| POST | /calvings | T | REP-04: `{ damId, pregnancyId?, date, calvingType, notes?, calves: [{ id?, code, sex, birthWeightKg?, health: ALIVE|WEAK|STILLBORN, breedId?, identifiers? }] }` → `{ pregnancy, calves }` |
| PATCH | /pregnancies/:id | T | Corregir fechas (recalcula fecha estimada) |
| POST | /pregnancies/:id/void | A | Anular |

## Sanidad
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | /vaccinations | T | Filtros: `animalId, vaccineId, from, to` |
| POST | /vaccinations | T | Individual (SAN-02) |
| POST | /vaccinations/bulk | T | `{ vaccineId, date, dose?, responsible?, batchNumber?, animalIds | filter }` → `{ created, skipped }` |
| GET | /vaccinations/due | T | Alertas: `status=overdue,due`, `vaccineId?` |
| POST | /vaccinations/:id/void | A/V | Anular |
| GET/POST | /treatments | T | Tratamientos (SAN-05); `cost` solo A |
| POST | /treatments/:id/void | A/V | Anular |

## Pesos y lotes
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | /animals/:id/weights | T | Serie y ganancia diaria: entre los dos últimos pesajes, en los últimos 90 días y desde el nacimiento (PES-02, PES-05), y fecha estimada para el peso objetivo de venta (PES-06, M8) |
| POST | /weights | T | `{ animalId, date, weightKg, method }` (respuesta incluye `warning` si difiere >30 %) |
| POST | /weights/:id/void | T (propio, 24 h) / A | Anular |
| GET/POST/PATCH | /scale-profiles, /scale-profiles/:id | T lee, A escribe | Perfiles de báscula de la finca: formato y mapeo de columnas del archivo del indicador (PES-04, M6) |
| POST | /weights/import?dryRun=true | T | `multipart/form-data` con el archivo y `scaleProfileId` (o el mapeo propuesto) → `{ rows, matched, unknownChips: [...], duplicates: [...], warnings: [...] }`. No guarda nada. Asocia por RFID y, si no hay, por chapeta visual |
| POST | /weights/import | T | El mismo archivo + `{ associations?: [{ chip, animalId }], skip?: [chip] }` → crea la jornada de pesaje (`WorkSession` con `WEIGHT`) y un pesaje por animal, en una transacción. Responde `{ workSessionId, created, skipped }` |

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
| Método | Ruta | Descripción |
|---|---|---|
| GET | /expenses | Filtros: `type, from, to, animalId` |
| POST | /expenses | `{ type, date, amount, description, allocation: { method: DIRECT|EQUAL|BY_WEIGHT, animalIds | filter } }` |
| POST | /expenses/:id/void | Anular (y sus asignaciones) |
| GET | /animals/:id/finance | Inversión, desglose, avalúo, venta, resultado |
| POST | /valuations | Avalúo manual |
| GET | /finance/summary | ECO-06 |

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
| GET | /dashboard | T | Indicadores RPT-01 (económicos solo A). Desde M8 agrega las preguntas del sistema productivo de la finca (CFG-03): destete e intervalo entre partos en cría, peso de venta y ganancia en ceba (PES-05, PES-06), vacas en ordeño, secas, leche de ayer y del mes, secar pronto y retiro de leche en lechería y doble propósito |
| GET | /reports/inventory | T | Por sexo, categoría de manejo, raza, lote |
| GET | /reports/inventory-ica | T | Grupos de edad y sexo en formato ICA |
| GET | /reports/births?from&to | T | NAC-01 |
| GET | /reports/vaccinations?from&to&vaccineId | T | Vacunados |
| GET | /reports/calvings-upcoming | T | Partos próximos |
| GET | /reports/exits?from&to&type | T | Vendidos o retirados |
| GET | /reports/:name/export?format=xlsx | T (económicos A) | Exportación |
| GET | /animals/:id/report.pdf | T | Ficha individual en PDF |
| GET | /export/full | A | Exportación completa (BAK-02) |

## Auditoría
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | /audit?animalId&entity&entityId&from&to&limit&cursor | A | Consulta paginada, de la más reciente a la más antigua |

- `animalId` trae el animal y sus identificadores (pestaña «Cambios» de la ficha); no se combina con `entity`. `entityId` exige `entity`. `entity`: `Animal`, `Identifier`, `Breed`, `Lot`, `Tag`, `Vaccine`, `VaccinationCycle`, `Farm`, `User`. `from` y `to` son días en la zona de la finca, ambos incluidos.
- Respuesta `{ items, nextCursor }`; cada elemento: `{ id, at, action, entity, entityId, entityLabel, user: { id, name } | null, changes: [{ field, before, after }] }`. `entityLabel` es el código del animal, el valor del identificador o el nombre del registro. En `changes`, los ids de raza, lote, madre, padre y etiquetas llegan como nombre o código.
- **Nunca** trae montos: no consulta gastos, ventas ni inicios de sesión, y descarta los campos con montos o precios (`amount`, `purchasePrice`, `pricePerKgByCategory`…). Un cambio de contraseña aparece como `password` sin valores.

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
| `DATE_IN_FUTURE` | 422 | La fecha no puede ser posterior a hoy. |
| `DATE_BEFORE_BIRTH` | 422 | La fecha es anterior al nacimiento del animal. |
| `CALVES_COUNT_INVALID` | 422 | Un parto puede registrar de 1 a 3 crías. |
| `VACCINE_SEX_BLOCKED` | 422 | La vacuna {vaccine} no se aplica a {sex}. |
| `WITHDRAWAL_ACTIVE` | 409 | El animal está en retiro hasta {date}. Confirma para continuar. |
| `SALE_AMOUNT_REQUIRED` | 422 | Indica el precio de venta. |
| `ALLOCATION_EMPTY` | 422 | Selecciona al menos un animal para repartir el gasto. |
| `ALLOCATION_NO_WEIGHT` | 422 | Hay animales sin peso registrado; usa reparto en partes iguales. |
| `WORK_SESSION_CLOSED` | 409 | La jornada ya fue cerrada. |
| `IMPORT_FILE_INVALID` | 422 | El archivo no tiene el formato de la plantilla. |
| `IMPORT_TOO_MANY_ROWS` | 413 | El archivo supera las 5.000 filas. |
| `IMPORT_FILE_TOO_LARGE` | 413 | El archivo supera los 5 MB. |
| `CODE_REASSIGNED` | 409 | El código {code} ya lo tiene el animal activo {holder}. Asígnale un código nuevo para revertir la salida. (IDN-06 CA3, con el animal en `context`) |
| `CODE_REUSE_CONFLICT` | 409 | Hay números repetidos entre animales activos y animales que salieron ({codes}). Cámbialos antes de desactivar la reutilización. (ANI-10 CA3) |
| `SCALE_FILE_INVALID` | 422 | No pudimos leer el archivo de la báscula. Revisa el formato o el perfil de báscula. (PES-04) |
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

Las advertencias (no bloqueantes) viajan en la respuesta exitosa como `warnings: [{ code, message }]`: `WEIGHT_OUTLIER`, `RFID_FOREIGN_COUNTRY`, `BREEDING_AGE_LOW`, `DAM_AGE_LOW` (la madre era menor que la edad mínima reproductiva al nacer la cría, RN-23), `VACCINE_AGE_OUTSIDE_WINDOW`, `ALREADY_IN_SESSION`, `CYCLE_OVERLAP` (el ciclo se cruza con otro), `LOT_HAS_ACTIVE_ANIMALS` («12 animales siguen en este lote», al desactivar un lote), `VACCINE_IN_ACTIVE_CYCLE` (al desactivar una vacuna de un ciclo en curso o futuro), `IDENTIFIER_NOT_RESTORED` (al revertir una salida o restaurar un archivado, un identificador que ya tiene otro animal activo quedó retirado; M4c), `SCALE_DUPLICATE_READING` (el mismo animal dos veces el mismo día en el archivo de la báscula: se conserva el último, PES-04), `MILK_UNFIT_FOR_SALE` (leche de una vaca con retiro de leche vigente, LEC-01 CA4).
