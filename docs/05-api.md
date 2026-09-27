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
- Errores: `application/problem+json` con `code` estable (catálogo en `packages/shared/src/errors.ts`).
- Roles: columna "Rol" (T = todos, A = ADMIN, V = VET, O = OPERATOR).

## Autenticación
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | /auth/login | — | `{ login, password }` (usuario o correo) → `{ accessToken, user, farm, role }` + cookie refresh |
| POST | /auth/refresh | — | Rota refresh token → nuevo `accessToken` |
| POST | /auth/logout | T | Revoca el refresh token |
| POST | /auth/change-password | T | `{ currentPassword, newPassword }` |
| GET | /me | T | Usuario, finca y rol actuales |

## Usuarios y finca
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | /users | A | Usuarios de la finca |
| POST | /users | A | Crear usuario (`username` obligatorio, `email` opcional) con rol y contraseña temporal |
| PATCH | /users/:id | A | Editar nombre, rol, activo |
| POST | /users/:id/reset-password | A | Genera contraseña temporal |
| GET | /farm | T | Datos y parámetros. `settings.pricePerKgByCategory` solo viaja para ADMIN (RN-20) |
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
| POST | /animals/:id/restore | A | Restaurar archivado |
| POST | /animals/:id/exit | A | `{ type, date, reason?, sale?: { amount, buyer? }, confirmWithdrawal? }` |
| POST | /animals/:id/revert-exit | A | Revierte salida (y anula la venta asociada) |
| GET | /animals/:id/timeline | T | Historial unificado paginado |
| GET | /animals/:id/genealogy | T | Madre, padre, crías (2 niveles) |
| POST | /animals/bulk/tags | T (forSale solo A) | `{ animalIds, add?: [], remove?: [], forSale? }` |
| POST | /animals/bulk/lot | T | `{ animalIds, lotId, date }` crea `LotMovement` |
| GET | /animals/:id/qr | T | PNG/SVG del QR |
| GET | /animals/next-code?birthDate= | T | Siguiente código sugerido según `calfCodePattern` |
| POST | /animals/qr-sheet | A | `{ animalIds, layout }` → PDF de etiquetas |

**Detalles de M4a.**
- `GET /animals` responde `{ items, nextCursor, total }`: `total` es el conteo con los filtros aplicados, sin paginar. Filtros: `category` (`CALF_MALE, CALF_FEMALE, HEIFER, COW, YOUNG_MALE, ADULT_MALE`); `tags` recibe etiquetas derivadas (`SERVED, PREGNANT, CALVED, DRY, WITHDRAWAL`) y claves de etiquetas manuales (`COTERO`…) en la misma lista; `alerts` acepta además `unconfirmed_service` (servida sin diagnóstico, RN-08). Varios valores de `category`, `breedId` o `lotId` se combinan con «o»; varios de `tags` o `alerts`, con «y». `status` es `active` por defecto; `archived` solo para ADMIN. `sort`: `code`, `age` (de menor a mayor edad), `lastWeight` y sus inversos con `-`; sin peso, al final. Solo los animales activos tienen alertas.
- `GET /animals/search?q=` → `{ exactMatch: { animalId, via, matches } | null, items }`. `via` y cada elemento de `matches` dicen por qué coincidió: `{ kind: 'CODE' | 'NAME', value }` o `{ kind: 'IDENTIFIER', identifierType, value, previous }` (`previous: true` es un identificador retirado). Hay `exactMatch` cuando todas las coincidencias exactas son del mismo animal; si son de animales distintos, `exactMatch` es `null` y cada uno aparece en `items` con `exact: true` y su porqué. La búsqueda difusa (`pg_trgm`) solo corre si no hubo ninguna coincidencia exacta, y desde 2 caracteres. No incluye archivados; sí los que salieron, con su `status`.
- `GET /animals/:id`: `economics: { purchasePrice }` solo existe en la respuesta de ADMIN. `POST /animals` y `PATCH /animals/:id` responden la ficha con `warnings`.
- `POST /animals/bulk/tags` y `/bulk/lot` son todo o nada: si un animal no es de la finca (404), está archivado (`ANIMAL_ARCHIVED`) o salió (`ANIMAL_EXITED`), no se cambia ninguno. `add` y `remove` son ids de etiquetas manuales. Respuestas: `{ updated }` y `{ moved, unchanged }`.
- `GET /animals/:id/timeline` → `{ items: [{ key, kind, date, voided, data }], nextCursor }`, del más reciente al más antiguo; los eventos anulados vienen con `voided: true`. No incluye datos económicos.

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
| GET | /animals/:id/weights | T | Serie y ganancia diaria |
| POST | /weights | T | `{ animalId, date, weightKg, method }` (respuesta incluye `warning` si difiere >30 %) |
| POST | /weights/:id/void | T (propio, 24 h) / A | Anular |

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
| GET | /dashboard | T | Indicadores RPT-01 (económicos solo A) |
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
| GET | /audit?entity&entityId&from&to | A | Consulta |

## Sincronización (F2)
| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | /sync/pull?since= | T | Cambios desde el cursor |
| POST | /sync/push | T | Lote de operaciones idempotentes |

## Importación (ANI-09, solo ADMIN)
| Método | Ruta | Descripción |
|---|---|---|
| GET | /imports/animals/template | Descarga la plantilla `.xlsx` (instrucciones, datos, listas válidas del catálogo de la finca) |
| POST | /imports/animals?dryRun=true | `multipart/form-data` con el archivo → `{ totalRows, valid, warnings: [...], errors: [{ row, column, code, message }] }`. No guarda nada. |
| POST | /imports/animals | Mismo archivo + `{ createMissingBreeds?: boolean }` → importa filas válidas; responde `{ importBatchId, created, skipped }` |
| GET | /imports/:id/errors.xlsx | Filas rechazadas con columna "Error" |

## Catálogo de códigos de error
Definido en `packages/shared/src/errors.ts` como constante; el `detail` en español es el mensaje por defecto (la UI puede usarlo tal cual). Estado HTTP entre paréntesis.

| Código | HTTP | Mensaje por defecto |
|---|---|---|
| `VALIDATION_FAILED` | 422 | Revisa los campos marcados. (con `errors` por campo) |
| `AUTH_INVALID_CREDENTIALS` | 401 | Usuario o contraseña incorrectos. |
| `AUTH_ACCOUNT_LOCKED` | 423 | La cuenta está bloqueada por intentos fallidos. Intenta de nuevo en 15 minutos. |
| `AUTH_PASSWORD_CHANGE_REQUIRED` | 403 | Debes cambiar tu contraseña temporal. |
| `AUTH_TOKEN_EXPIRED` | 401 | La sesión expiró. Vuelve a iniciar sesión. |
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
| `RATE_LIMITED` | 429 | Demasiadas solicitudes. Espera un momento. |
| `INTERNAL_ERROR` | 500 | Ocurrió un error inesperado. Ya quedó registrado. |

Las advertencias (no bloqueantes) viajan en la respuesta exitosa como `warnings: [{ code, message }]`: `WEIGHT_OUTLIER`, `RFID_FOREIGN_COUNTRY`, `BREEDING_AGE_LOW`, `DAM_AGE_LOW` (la madre era menor que la edad mínima reproductiva al nacer la cría, RN-23), `VACCINE_AGE_OUTSIDE_WINDOW`, `ALREADY_IN_SESSION`, `CYCLE_OVERLAP` (el ciclo se cruza con otro), `LOT_HAS_ACTIVE_ANIMALS` («12 animales siguen en este lote», al desactivar un lote), `VACCINE_IN_ACTIVE_CYCLE` (al desactivar una vacuna de un ciclo en curso o futuro).
