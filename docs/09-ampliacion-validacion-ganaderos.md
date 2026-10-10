# Ampliación de requisitos: validación con ganaderos (v1.4)

Estado: v1.2 aprobada por el product owner el 27/09/2026; v1.3 (hallazgo H4, §5) agregada el 28/09/2026; v1.4 (báscula Tru-Test, §3) el 28/09/2026. Integrar en `01-srs.md`, `03-modelo-datos.md`, `04-arquitectura.md` (ADR-007 y variables de entorno), `05-api.md`, `06-ux-ui.md`, `07-plan-desarrollo.md` y `08-dominio-y-finca-referencia.md`.

Origen: conversaciones con ganaderos de la región durante la fase de diseño. Son hallazgos de validación con usuarios (fase 5 de la metodología de ciencia del diseño) y se documentan como tales en el componente académico.

Convenciones: igual que en `08`, **[Real]** indica una práctica o dato verificado del sector y **[Validar]** un valor por defecto razonable que debe confirmarse con la finca o el veterinario. Los valores [Validar] viven en configuración, nunca fijos en el código.

---

## 1. Hallazgos

| # | Problema observado | Situación en la especificación v1.1 |
|---|---|---|
| H1 | Muchas fincas numeran sus animales 1, 2, 3… y reasignan el número de un animal vendido a uno nuevo. En el software que usan, el historial del vendido queda asociado al número y se mezcla con el del animal nuevo. | El historial ya pertenece a un identificador interno inmutable, no al número (correcto). Pero RN-01 y RN-28 **impiden** reutilizar códigos, lo que choca con esa costumbre. |
| H2 | El pesaje periódico se hace en báscula electrónica; digitar cada peso es lento y propenso a errores. Quieren que el peso se asocie solo al chip leído. | PES-03 (báscula Bluetooth) estaba en prioridad C y fase 3. La evolución del peso (PES-02) sí existe. En v1.4 se fija Tru-Test como primera marca. |
| H3 | Cada finca vende cosas distintas: unas solo machos (ceba), otras hembras o terneros destetados (cría), otras producen leche. Necesitan cifras y parámetros distintos, incluida la producción de leche. | Todas las fincas se tratan igual. El control de leche estaba **fuera de alcance**. |
| H4 | Entrar con usuario y contraseña cada vez que se quiere consultar algo desanima el uso en campo. Se pide además entrar con la cuenta de Google y verificar por correo los datos de quien se registra. | La sesión ya dura 30 días en el mismo equipo, pero caduca aunque se use a diario. No hay correo saliente, ni recuperación de contraseña por correo, ni inicio con Google. Los usuarios los crea el ADMIN; no hay registro abierto. |

---

## 2. Numeración reutilizable (H1)

### Requisitos

**ANI-10 — Modo de numeración de la finca** · M · F1 (M4c)
La finca elige en Configuración:
- `codeReuse` (por defecto `false`): "Reutilizar números de animales que salen de la finca".
- `codeSuggestion`: `PATTERN` (patrón `calfCodePattern`, comportamiento actual) o `LOWEST_FREE` (sugiere el número libre más bajo entre los animales activos).
- CA1: Con `codeReuse = true`, el código solo es único entre animales **activos** (sin salida y no archivados). Con `false`, sigue siendo único entre todos los no archivados (RN-01 original).
- CA2: Con `LOWEST_FREE`, `next-code` devuelve el menor entero positivo que no usa ningún animal activo (si se vendió el 5, sugiere 5). Solo aplica a códigos numéricos.
- CA3: Cambiar de `codeReuse = true` a `false` se rechaza si hoy hay dos animales (uno activo y otro que salió) con el mismo código; el mensaje indica cuáles.

**ANI-11 — Número anterior en la ficha y en la búsqueda** · M · F1 (M4c)
- CA1: La búsqueda exacta de un código devuelve el animal **activo** que lo tiene. Si ningún activo lo tiene y lo tuvo uno que salió, devuelve ese animal con su estado (Vendido, Retirado).
- CA2: La ficha de un animal activo muestra, si su código lo usó antes otro animal: "Este número lo tuvo antes 5 · vendido el 12/03/2026", con enlace a la ficha de ese animal.
- CA3: La ficha de un animal que salió muestra: "Su número 5 lo tiene hoy otro animal", con enlace.
- CA4: El historial (Timeline) de cada animal nunca incluye eventos de otro animal con el mismo número.

**IDN-06 — Liberación de chapetas al salir** · M · F1 (M4c)
- CA1: Con `codeReuse = true`, al registrar la salida de un animal, sus identificadores `VISUAL_TAG` se retiran automáticamente con motivo `EXITED` y fecha de salida, y quedan disponibles para otro animal sin confirmación (excepción a RN-19).
- CA2: Los identificadores `DIN` y `RFID` **nunca** se liberan ni se reutilizan: son únicos de por vida según el ICA. Siguen asociados al animal que salió.
- CA3: Revertir una salida (ANI-04 CA5) cuando su código o su chapeta ya los tiene otro animal activo exige asignarle un código nuevo; error `CODE_REASSIGNED` con el código del animal que lo tiene.

### Reglas de negocio nuevas

| ID | Regla |
|---|---|
| RN-30 | La unicidad del código compara el código normalizado: sin espacios al inicio ni al final, en mayúsculas y, si es solo numérico, sin ceros a la izquierda ("5", "05" y "005" son el mismo código). Aplica en todas las fincas. |
| RN-31 | La base garantiza la unicidad entre animales activos con un índice único parcial. La regla más estricta de las fincas con `codeReuse = false` (únicos entre todos los no archivados) se verifica en la aplicación dentro de la transacción. |
| RN-32 | DIN y RFID son identificadores de por vida: nunca se reasignan a otro animal, sin importar el modo de numeración. Solo `VISUAL_TAG`, `BRAND` y `OTHER` pueden liberarse. |
| RN-33 | Un número liberado conserva la trazabilidad: cada animal que lo usó mantiene su identificador interno, su historial completo y la fecha en que tuvo ese número. |

### Modelo de datos
- `Farm.settings`: `codeReuse: boolean`, `codeSuggestion: 'PATTERN' | 'LOWEST_FREE'`.
- `IdentifierRetireReason`: agregar `EXITED`.
- Índice único de `animals.code` pasa a la expresión normalizada (RN-30) y a animales activos (RN-31).
- Seed: la finca de referencia sigue con `codeReuse = false`. Agregar una segunda finca pequeña de pruebas ("Finca El Retiro", [Ficticio]) con `codeReuse = true`, `LOWEST_FREE` y numeración 1–40, con al menos dos números reutilizados (un animal vendido y otro activo con el mismo número) para las pruebas.

---

## 3. Báscula y peso (H2)

**Hallazgo técnico [Real]:** los indicadores de pesaje ganadero del mercado (por ejemplo, las líneas de Tru-Test/Datamars, Gallagher o Iconix; confirmar modelos concretos) usan protocolos propios y, en muchos casos, Bluetooth clásico (perfil de puerto serie). Un navegador no puede conectarse a Bluetooth clásico: Web Bluetooth solo admite Bluetooth de bajo consumo y no está disponible en iPhone. La conexión directa requiere la app móvil (fase 2) o la de escritorio (fase 3). En Colombia, Tru-Test (Datamars) tiene distribuidor oficial y ofrece los indicadores S3, EziWeigh7i y XR5000 con Bluetooth; XR5000 e ID5000 ya se integran con apps de terceros en Android e iPhone enviando el par chip + peso. Casi todos los indicadores permiten exportar cada sesión de pesaje (chip, peso, fecha y hora) como archivo CSV, lo que permite resolver el problema desde la web.

### Requisitos

**PES-04 — Importar sesión de pesaje desde el archivo de la báscula** · M · F1 (M6)
- CA1: El usuario sube el archivo CSV o Excel exportado por el indicador. El sistema propone el mapeo de columnas (RFID o EID, número visual, peso, fecha y hora) y lo guarda como **perfil de báscula** de la finca para reutilizarlo. Se incluye un perfil predefinido "Tru-Test" para los archivos que exportan XR5000, ID5000 y S3 (por USB o por la app del fabricante); sus columnas exactas se definen con un archivo real exportado por la finca piloto.
- CA2: Simulación primero, como ANI-09: filas asociadas (por RFID y, si no hay, por chapeta visual), filas con chip desconocido, duplicados (mismo animal el mismo día: se conserva el último y se avisa) y pesos atípicos (PES-01, diferencia mayor a 30 %).
- CA3: Los chips desconocidos se pueden asociar a un animal existente o dejar sin importar.
- CA4: Al confirmar, se crea una jornada de pesaje (`WorkSession` con actividad `WEIGHT`) con un `WeightRecord` por animal, método `SCALE`, en una transacción.

**PES-05 — Ganancia de peso y alertas** · S · F1 (M6 cálculo y ficha, M8 tablero)
- CA1: Para cada animal: ganancia diaria promedio (kg/día) entre los dos últimos pesajes, en los últimos 90 días y desde el nacimiento.
- CA2: Alerta "Ganancia baja" si la ganancia de los últimos 90 días es menor que el umbral de su categoría (`weightGainAlertKgPerDay`, por categoría de manejo; valor por defecto 0,30 kg/día para Levante [Validar]).
- CA3: Alerta "Perdió peso" si el último pesaje es menor que el anterior en más de `weightLossAlertPercent` (por defecto 5 % [Validar]).
- CA4: Listado filtrable por estas alertas y resumen por lote.

**PES-06 — Peso objetivo de venta** · S · F1 (M8)
- CA1: La finca define un peso objetivo de venta por sexo o categoría (`targetSaleWeightKg`; por defecto 450 kg en machos de Levante [Validar]).
- CA2: Para cada animal con al menos dos pesajes: fecha estimada en que alcanzará el peso objetivo, según su ganancia de los últimos 90 días.
- CA3: Pregunta del tablero en fincas de ceba: "¿Cuáles alcanzan el peso de venta este mes?".

**PES-03 — Pesaje en vivo con indicador Tru-Test (Datamars)** · S · F2 (M15)

**Decisión del product owner (28/09/2026):** la integración en vivo se hace primero con **Tru-Test (Datamars)**, la marca con distribuidor oficial y mayor presencia en Colombia. Se empieza por los indicadores XR5000 e ID5000 (y JR5000, de la misma familia), que ya se conectan por Bluetooth a apps de terceros en Android y en iPhone y envían el par chip + peso. S3 y EziWeigh7i se agregan al mismo adaptador si la documentación del fabricante los cubre. Otras marcas quedan en PES-08.

*Flujo en la manga:*
1. El animal entra al cajón de la báscula.
2. Se lee su chip: con el lector conectado al indicador (bastón XRS2 o lector de panel) o con un lector Bluetooth conectado al celular (IDN-04).
3. La app muestra la ficha resumida: código en Chapeta, categoría, último peso y fecha.
4. Cuando el peso es estable, se guarda solo y se asigna a ese animal. La pantalla muestra el peso, la ganancia desde el último pesaje y las alertas de PES-05.
5. El animal sale; el siguiente registro no ocurre hasta que la báscula vuelve cerca de cero.

*Modos de conexión:*
- **Modo A, el indicador asocia (preferido):** el lector está conectado al indicador y este se configura para enviar "EID y peso cuando se registra el peso", con grabación automática al estabilizarse. La app recibe el par, busca el animal por RFID y guarda. La asociación la hace la báscula, que es lo más confiable.
- **Modo B, la app asocia:** el lector va conectado al celular y el indicador solo envía el peso. La app aplica las condiciones de guardado.

*Condiciones de guardado (modo B; en el modo A se verifican como protección adicional):*
- CA1: Hay un animal identificado en la jornada y ningún peso registrado todavía para esa lectura.
- CA2: El peso es estable: lo indica el propio indicador o, si no lo informa, la variación es menor o igual a `scaleStableToleranceKg` (por defecto 1 kg [Validar]) durante `scaleStableSeconds` (2 s [Validar]); y es mayor que `scaleMinWeightKg` (20 kg [Validar]).
- CA3: Desde el último registro, la báscula volvió por debajo de `scaleZeroThresholdKg` (10 kg [Validar]). Así el peso de un animal nunca queda en el siguiente.

*Criterios adicionales:*
- CA4: Chip desconocido: la app pregunta si se asocia a un animal existente, se registra como animal nuevo o se omite; el peso queda retenido mientras tanto.
- CA5: El mismo animal dos veces seguidas en la jornada: aviso y opción de reemplazar el peso anterior o conservar ambos. Peso atípico: aviso de PES-01 (diferencia mayor a 30 %).
- CA6: Cada pesaje guarda método `SCALE` y el número de serie del indicador, para trazabilidad.
- CA7: Si se pierde la conexión, la app avisa, intenta reconectar y no pierde lo ya pesado: cada registro se guarda en el celular antes de enviarse (misma sincronización de SYN-01).
- CA8: Corrección manual: el operario puede anular el último registro (con motivo) o digitar el peso si la báscula falla.

*Arquitectura:* interfaz `ScaleAdapter` (conectar, estado, flujo de lecturas `{ weightKg, stable, eid?, at }`, desconectar) con una implementación `TruTestAdapter` y un adaptador simulado para pruebas, que reproduce sesiones grabadas de una báscula real. La lógica de CA1 a CA5 vive en `packages/shared` y es independiente de la marca.

*Prerrequisitos (antes de M15):*
1. Confirmar marca y modelo del indicador de la finca piloto y su versión de firmware (en iPhone se requiere 4.7.8 o superior para XR5000, ID5000 y JR5000 [Real, según la documentación de integraciones de terceros]).
2. Solicitar a Datamars (Datamars Colombia o su distribuidor) la documentación de integración Bluetooth para desarrolladores. Pedirla con al menos dos meses de anticipación; si no se obtiene, M15 incluye solo el lector RFID Bluetooth y el peso digitado en la jornada, y la báscula sigue integrada por archivo (PES-04) hasta tener la documentación.
3. Tener acceso a un indicador real para desarrollo y pruebas (el de la finca piloto o uno prestado por el distribuidor), y grabar sesiones reales para el adaptador simulado.

*Modelo de datos:* `Farm.settings`: `scaleStableToleranceKg`, `scaleStableSeconds`, `scaleMinWeightKg`, `scaleZeroThresholdKg`. `WeightRecord`: `scale_serial` opcional. `ScaleProfile` (PES-04) incluye el perfil predefinido Tru-Test.

*Estimación:* flujo común (jornada, condiciones, reconexión) 1 a 2 semanas; adaptador Tru-Test 1 a 2 semanas con el equipo disponible.

**PES-07 — Báscula por cable en escritorio** · C · F3 (M18)
- CA1: La app de escritorio (Tauri) se conecta al indicador Tru-Test por USB o Bluetooth con el mismo `TruTestAdapter` y la lógica compartida de PES-03.

**PES-08 — Otras marcas de báscula** · C · futuro
- Gallagher (TW-3, TWR-5) e indicadores genéricos que transmiten el peso continuamente por puerto serie o adaptador Bluetooth, con perfil configurable. Se implementan sobre el mismo `ScaleAdapter` cuando haya fincas que los usen.

---

## 4. Sistema productivo y control de leche (H3)

### 4.1 Sistema productivo de la finca

**CFG-03 — Sistema productivo** · M · F1 (M8)
- Campo `Farm.settings.productionSystem`: `CRIA` (cría), `LEVANTE_CEBA` (levante y ceba), `LECHERIA` (lechería especializada), `DOBLE_PROPOSITO` o `CICLO_COMPLETO`. Por defecto `DOBLE_PROPOSITO` (finca de referencia).
- Campo opcional `salesFocus`: `MALES`, `FEMALES` o `BOTH`: qué vende principalmente la finca.
- CA1: No cambia datos ni reglas: cambia **qué se destaca** en el tablero, el orden de los reportes y qué alertas aparecen primero.
- CA2: El módulo de leche (§4.2) solo aparece con `LECHERIA` o `DOBLE_PROPOSITO`.
- CA3: Con `salesFocus`, el listado de "Disponibles para venta" y las sugerencias de venta se centran en ese sexo.

**Preguntas del tablero por sistema** (06 §5.1; se agregan a las comunes: total, preñadas, partos próximos, vacunas):

| Sistema | Preguntas propias |
|---|---|
| Cría | ¿Cuántos terneros se destetan este mes y con qué peso? · ¿Cuál es el intervalo entre partos del hato? · ¿Cuántas vacas están horras? |
| Levante y ceba | ¿Cuáles alcanzan el peso de venta este mes? (PES-06) · ¿Qué lotes ganan menos peso de lo esperado? (PES-05) · ¿Cuántos días faltan en promedio para la venta? |
| Lechería y doble propósito | ¿Cuántas vacas están en ordeño y cuántas secas? · ¿Cuánta leche se produjo ayer y en el mes? · ¿Cuáles se deben secar pronto? · ¿Cuáles están en retiro de leche? |
| Ciclo completo | Combinación de cría y ceba. |

**Referencias de indicadores [Real]:** en sistemas doble propósito en Colombia, UPRA (2024) reporta producción de 5,69 a 9,88 litros por vaca al día, destete hacia los 7 meses y un intervalo entre partos de 387 a 439 días. Sirven como referencia en los reportes, no como umbrales fijos.

### 4.2 Control de leche

**Términos (se agregan al glosario del SRS):**

| Término | Código | Definición |
|---|---|---|
| En ordeño | etiqueta derivada `LACTATING` | Vaca con un parto y sin secado posterior: está produciendo leche. |
| Seca | etiqueta derivada `DRIED_OFF` | Vaca a la que se le suspendió el ordeño (secado) y aún no vuelve a parir. |
| Secado | evento `DryOffRecord` | Fin del ordeño de una lactancia. |
| Lactancia | derivado | Periodo entre un parto y el siguiente secado (o la salida del animal). |
| Días en leche (DEL) | derivado | Días transcurridos desde el último parto de una vaca en ordeño. |
| Control lechero | `MilkRecord` | Registro de los litros producidos por una vaca en una fecha. |

**Advertencia de nomenclatura:** la etiqueta derivada existente `DRY` significa **Horra** (vaca no preñada ni servida, sin cría al pie), no "seca". "Seca" es `DRIED_OFF`. No renombrar `DRY` (ya está implementado y probado), pero dejar esta aclaración en el glosario y en un comentario junto a la constante.

**LEC-01 — Registro de producción de leche** · M · F1 extendida (M9b)
- CA1: Registro por vaca y fecha: litros (decimal, NumberField), ordeño (`AM`, `PM` o `TOTAL`), método (`METER` medidor, `ESTIMATE` estimado).
- CA2: Registro rápido por **jornada de ordeño**: lista de las vacas en ordeño del lote con un campo de litros por vaca y teclado numérico; se guarda todo junto.
- CA3: Solo se registra leche de hembras con al menos un parto y sin secado posterior; en otro caso, error `NOT_LACTATING` con explicación.
- CA4: Si la vaca tiene retiro de leche vigente (tratamiento con `withdrawalMilkDays`), el registro se acepta pero queda marcado "Leche no apta para la venta" y la jornada lo destaca.

**LEC-02 — Estado de lactancia** · M · F1 extendida (M9b)
- CA1: Etiquetas derivadas `LACTATING` y `DRIED_OFF`, con días en leche en la ficha y en el listado.
- CA2: Se calculan con funciones de `packages/shared/src/domain` y con su equivalente SQL, cubiertos por la prueba de equivalencia de ADR-009 (RN-27).

**LEC-03 — Registrar secado** · M · F1 extendida (M9b)
- CA1: Fecha y motivo (fin de lactancia, baja producción, preparación para el parto, enfermedad, otro).
- CA2: Alerta "Secar pronto": vaca en ordeño y preñada cuyo parto estimado ocurre en menos de `dryOffBeforeCalvingDays` (por defecto 60 días [Validar]; la práctica común es un periodo seco de 45 a 60 días antes del parto).

**LEC-04 — Producción por lactancia y por vaca** · S · F1 extendida (M9b)
- CA1: En la ficha, pestaña "Leche": curva de producción de la lactancia actual, producción acumulada, promedio diario, pico y comparación con lactancias anteriores.

**LEC-05 — Reportes de leche** · S · F1 extendida (M9b)
- CA1: Producción diaria y mensual del hato; producción por lote; ranking de vacas por promedio diario; vacas por debajo de un umbral configurable; exportable a Excel.

**LEC-06 — Ordeño sin conexión** · M · F2 (M16)
- CA1: La jornada de ordeño funciona en la app móvil sin señal, con la misma sincronización de SYN-01.

**Reglas de negocio nuevas:**

| ID | Regla |
|---|---|
| RN-34 | Una lactancia empieza en la fecha de un parto con desenlace `CALVED` (con o sin cría viva) y termina en el primer secado posterior o en la salida de la vaca. |
| RN-35 | `MilkRecord.recorded_on` debe estar dentro de una lactancia abierta de la vaca; nunca en el futuro (RN-14). |
| RN-36 | Solo puede haber un registro por vaca, fecha y ordeño; un segundo registro del mismo ordeño reemplaza al anterior (se anula el anterior con motivo). |
| RN-37 | Registrar un nuevo parto en una vaca en ordeño cierra implícitamente la lactancia anterior (sin secado registrado) y abre una nueva; la ficha lo muestra como "Lactancia cerrada por nuevo parto". |

**Modelo de datos:**
- `MilkRecord`: `id, farm_id, animal_id, recorded_on date, milking enum (AM, PM, TOTAL), liters numeric(6,2), method enum (METER, ESTIMATE), unfit_for_sale bool, work_session_id?, notes?, voided_at, void_reason, created_*`. Índices: `(farm_id, recorded_on)`, `(animal_id, recorded_on DESC)`; único parcial `(animal_id, recorded_on, milking) WHERE voided_at IS NULL`.
- `DryOffRecord`: `id, farm_id, animal_id, dried_on date, reason enum, notes?, voided_at, void_reason, created_*`.
- `WorkSession.activities`: agregar la actividad `MILKING`.
- `Farm.settings`: `productionSystem`, `salesFocus?`, `dryOffBeforeCalvingDays` (60), `weightGainAlertKgPerDay` (por categoría), `weightLossAlertPercent` (5), `targetSaleWeightKg` (por sexo o categoría).
- Seed: la finca de referencia (doble propósito) recibe 90 días de control lechero coherente para sus vacas en ordeño y algunos secados, con cifras esperadas nuevas en `expected.ts` (vacas en ordeño, secas, secar pronto, producción de ayer y del mes). Producción por vaca entre 4 y 10 litros diarios, consistente con UPRA (2024).

---

## 5. Cuentas, sesión y correo (H4)

**Decisión del product owner:** el sistema se valida primero con la finca piloto y queda preparado para ofrecerse después a otras fincas. Por eso se hace **invitación por correo** (el ADMIN invita) y no registro abierto; el registro abierto queda como fase futura (§5.4).

**Restricción [Real]:** muchos operarios de campo no tienen correo o no lo revisan (08 §1.8). El correo es obligatorio para ADMIN, opcional para VET y OPERATOR. Quien no tiene correo sigue entrando con usuario y contraseña temporal que crea el ADMIN (flujo actual con `mustChangePassword`).

### 5.1 Sesión que no caduca con el uso (núcleo, M4d)

**AUT-10 — Sesión deslizante** · M · F1 (M4d)
- CA1: Cada renovación del token de actualización extiende su vencimiento a 30 días desde ese momento (`REFRESH_TTL_DAYS`). Quien abre la app al menos una vez al mes no vuelve a escribir la contraseña en ese equipo.
- CA2: Tope absoluto por familia de sesión de `REFRESH_MAX_AGE_DAYS` (por defecto 180 días [Validar]); al cumplirse, se pide la contraseña una vez y empieza una familia nueva.
- CA3: Cambiar la contraseña, desactivar al usuario o quitarle la membresía revoca todas sus sesiones (lo último ya lo cubre AccessGuard; se agrega la revocación explícita).
- CA4: Se mantiene todo lo de ADR-007: rotación en cada uso, revocación de la familia si se reutiliza un token rotado, cookie HttpOnly/Secure/SameSite=Strict, token de acceso de 15 minutos solo en memoria.

**AUT-11 — Sesiones activas** · M · F1 (M4d)
- CA1: En Mi cuenta → Sesiones: lista de equipos con sesión abierta (navegador y sistema resumidos del `userAgent`, fecha de inicio, último uso), marcando "Este equipo".
- CA2: "Cerrar sesión en este equipo" para cada fila y "Cerrar las demás sesiones".
- CA3: El ADMIN puede cerrar todas las sesiones de un usuario de su finca desde Usuarios (equipo perdido o prestado).
- CA4: El último uso se actualiza como máximo una vez por hora por sesión para no escribir en cada petición.

### 5.2 Correo, invitación y recuperación (M10a)

**AUT-12 — Correo saliente** · M · F1 (M10a)
- Servicio transaccional detrás de una interfaz `Mailer` (implementación SMTP genérica; proveedor definido en el despliegue). Dominio propio con SPF, DKIM y DMARC. En desarrollo y pruebas, `Mailer` en memoria o Mailpit en Docker; nunca se envía correo real desde pruebas.
- Plantillas en español de Colombia, texto plano + HTML simple, sin imágenes remotas.

**AUT-13 — Invitación por correo** · M · F1 (M10a)
- CA1: El ADMIN invita escribiendo correo y rol. Se envía un enlace de un solo uso que vence en 7 días (`invitation_tokens`: solo se guarda el hash).
- CA2: Al abrir el enlace, la persona elige su nombre y contraseña, o continúa con Google (AUT-15). Aceptar la invitación **verifica el correo** (el enlace llegó a ese buzón) y deja la sesión abierta (AUT-10).
- CA3: El ADMIN ve las invitaciones pendientes, puede reenviarlas o anularlas.
- CA4: Crear usuarios sin correo (operarios) sigue disponible como hoy.

**AUT-14 — Verificación y recuperación por correo** · M · F1 (M10a)
- CA1: `users.email_verified_at`. Todo correo nuevo o cambiado se verifica con un enlace (24 h); hasta entonces no se usa para recuperar la contraseña ni para iniciar con Google.
- CA2: "¿Olvidaste tu contraseña?": enlace de un solo uso de 1 hora a correos verificados. La respuesta es la misma exista o no la cuenta (no revela qué correos están registrados). Al restablecer, se revocan todas las sesiones.
- CA3: Límite de envíos: 3 por correo por hora y el límite general por IP.
- CA4: Los ADMIN existentes (seed y piloto) verifican su correo en el primer inicio de sesión después del despliegue; se muestra un aviso hasta hacerlo.

### 5.3 Iniciar con Google (M10a)

**AUT-15 — Google como método de acceso** · S · F1 web (M10a), F2 móvil
- CA1: Flujo OpenID Connect con código de autorización y PKCE, del lado del servidor. Se valida el `id_token` (firma, `iss`, `aud`, `exp`, `nonce`) y se exige `email_verified = true`.
- CA2: **No crea cuentas ni fincas por sí solo.** Entra si el correo de Google coincide con un usuario existente con correo verificado, o si acepta una invitación dirigida a ese correo. En otro caso: "Esta cuenta de Google no tiene acceso a ninguna finca. Pídele al administrador una invitación".
- CA3: En Mi cuenta se puede vincular y desvincular Google (pide la contraseña actual). No se puede desvincular el único método de acceso.
- CA4: Tabla `user_identities (user_id, provider, subject, email, linked_at)`, único `(provider, subject)`. El vínculo se hace por `subject`, no por correo, después del primer ingreso.
- CA5: Requiere proyecto en Google Cloud, pantalla de consentimiento con nombre, logo, política de privacidad y términos publicados en el dominio (se redactan en M10a; la política también sirve al componente académico: Ley 1581 de 2012 de protección de datos personales).
- En la app móvil (fase 2) se usa el inicio nativo de Google y el token de actualización va en el almacenamiento seguro del sistema, no en cookie.

### 5.4 Registro abierto (fuera de alcance de F1)

**REG-01 — Registro de fincas nuevas** · C · futuro (solo si Arreo se ofrece como producto)
Cualquier ganadero crea su cuenta (correo y contraseña o Google, con verificación obligatoria) y su finca con asistente de configuración inicial. Implica además: protección contra cuentas falsas, términos de servicio, planes o cobro, soporte y borrado de cuenta y datos a solicitud. Se documenta para mostrar que la arquitectura multi-finca ya lo permite, pero no se programa.

### Modelo de datos
- `users`: `email_verified_at timestamptz?`; `email` pasa a obligatorio para quien tenga membresía ADMIN (se verifica en la aplicación).
- `refresh_tokens`: `family_started_at`, `last_used_at`; `expires_at` se recalcula en cada rotación con el tope de CA2.
- Nuevas: `email_tokens (id, user_id, purpose enum VERIFY_EMAIL | RESET_PASSWORD, email, token_hash, expires_at, used_at)`, `invitations (id, farm_id, email, role, token_hash, invited_by, expires_at, accepted_at, revoked_at)`, `user_identities`.
- Auditoría: invitación creada, aceptada y anulada; correo verificado; contraseña restablecida; Google vinculado y desvinculado; sesiones cerradas por el ADMIN.
- Variables: `REFRESH_TTL_DAYS`, `REFRESH_MAX_AGE_DAYS`, `SMTP_*`, `MAIL_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Los enlaces de los correos usan `PUBLIC_WEB_URL`, que ya existe (la misma URL pública de los QR). Sin `GOOGLE_*`, el botón de Google no aparece.

---

## 6. Programación en los avances

| Hito | Qué se agrega | Nivel |
|---|---|---|
| **M4c** | ANI-10, ANI-11, IDN-06, RN-30 a RN-33; segunda finca de pruebas con numeración reutilizable. | Núcleo |
| **M4d** | AUT-10 sesión deslizante y AUT-11 sesiones activas (1 a 2 días, junto con importación y exportación a Excel, QR y etiquetas). | Núcleo |
| **M6** | PES-04 (importar sesión de la báscula), PES-05 cálculo de ganancia y alertas en la ficha y el listado. | Núcleo |
| **M8a** | CFG-03 (sistema productivo), tablero por sistema, PES-05 en el tablero, PES-06 (peso objetivo). | Núcleo |
| **M8b** | BAK-02 (exportación completa, primero), RPT-02 (reportes estándar), reporte ICA y RPT-03 (gráficas). | Núcleo |
| **M9** | Jornada de pesaje con lector en modo teclado y peso digitado (ya previsto en JOR), reutilizando las alertas de PES-05. | Completo |
| **M9b (nuevo)** | Control de leche: LEC-01 a LEC-05, RN-34 a RN-37, seed de leche. | Completo (se ejecuta si el cronograma lo permite antes del piloto; si no, pasa a la fase 2) |
| **M10a (nuevo)** | AUT-12 correo saliente, AUT-13 invitación, AUT-14 verificación y recuperación por correo, AUT-15 Google en la web, política de privacidad y términos. M10 pasa a llamarse M10b (endurecimiento y despliegue). | Núcleo (unas 2 semanas) |
| **M15** | PES-03 pesaje en vivo con indicador Tru-Test (XR5000, ID5000, JR5000) en la app móvil, junto con el lector RFID Bluetooth (IDN-04). Requiere los prerrequisitos de PES-03. | Fase 2 |
| **M16** | LEC-06 ordeño sin conexión en la app móvil. OCR de chapetas (IDN-05) pasa a M17. | Fase 2 |
| **M18** | Empaquetado de escritorio (Tauri) y PES-07 indicador Tru-Test por cable. | Fase 3 |

**Impacto en el cronograma:** M9b suma unas 3 semanas y M10a unas 2. Si hay que recortar antes del piloto, el orden es: primero M9b pasa a la fase 2; luego AUT-15 (Google) pasa a la fase 2. AUT-12 a AUT-14 no se recortan: sin correo no hay recuperación de contraseña en el piloto. La decisión sobre M9b se toma al terminar M9; la de AUT-15, al empezar M10a.

**Preguntas pendientes para la finca piloto:**
1. Marca y modelo del indicador de la báscula (se busca Tru-Test XR5000, ID5000, JR5000, S3 o EziWeigh7i), versión de firmware, y si exporta archivos (CSV o Excel) y por qué medio (USB, app del fabricante). Pedir un archivo exportado real para el perfil de PES-04.
2. Si el indicador tiene lector de chip conectado (bastón XRS2 o panel) o se usa un lector aparte, y si el celular de la manga es Android o iPhone.
3. Sistema productivo real y qué vende principalmente.
4. Si numeran del 1 en adelante y reasignan números de animales vendidos.
5. Cómo registran hoy la leche: por ordeño, total diario o pesajes periódicos (control lechero mensual).
6. Quiénes usarán la app, cuáles tienen correo y si usan cuentas de Google (Gmail) en el celular.
7. (M8a) Cómo llaman al macho de ceba mayor de 24 meses (novillo, torete, novillo gordo…) y si separan los reproductores del resto de los machos. **Hallazgo de dominio para validar en el piloto:** la categoría de manejo es por edad (08 §2.1) y muestra «Toro» a todo macho de 24 meses o más, también a un novillo de ceba que la finca está por vender. M8a no cambia las categorías: el peso objetivo de venta se aplica a Levante y Toro, y los reproductores se excluyen con la etiqueta del sistema «Reproductor». Si la finca llama distinto a esos machos, se decide entonces si hace falta una categoría o una etiqueta nueva.
8. (M8a) El peso objetivo de venta (450 kg para Levante y Toro) y si cambia por sexo, raza o temporada.
9. (M8b) Qué reportes consulta primero según lo que hace la finca: el orden propuesto (`reportOrder`, 08 §3.7) pone los partos y los nacimientos primero en cría y doble propósito, y el inventario, las salidas y la plata primero en ceba.
10. (M8b) Si el inventario por grupos de edad que entrega Arreo (una tabla por sexo con los grupos del 08 §2.2, la finca, el código de predio y la fecha de corte) sirve tal cual para los trámites y los ciclos de vacunación, o si el ICA o el vacunador de Fedegán piden otra presentación (por ejemplo, el cuadro de población con los grupos en columnas).
11. (Ajuste previo de M9) Si usan o piensan usar chips inyectables (o bolos ruminales) y dónde los aplican (base de la oreja, cuello u otro sitio), para indicarlo al vaquero en la manga y al lector, y si el lector de la finca lee FDX-B y HDX.

## Fuentes
- Datamars Colombia (s. f.). Básculas Tru-Test. https://www.datamarscolombia.com/Basculas.aspx
- AgriWebb (s. f.). Connecting the Tru-Test XR5000 or ID5000. https://help.agriwebb.com/en/articles/4217670-connecting-the-tru-test-xr5000-or-id5000-iam
- Google (s. f.). OpenID Connect. Google Identity. https://developers.google.com/identity/openid-connect/openid-connect
- Congreso de Colombia (2012). Ley 1581 de 2012, protección de datos personales. https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981
- UPRA (2024). Sistema productivo en ganadería bovina doble propósito. https://upra.gov.co/sites/default/files/2025-03/01_CosProdBov2_20241223.pdf
- ICA (2012). Resolución 338 de 2012, Norma DIN (identificación única de por vida). https://faolex.fao.org/docs/pdf/col118137.pdf
