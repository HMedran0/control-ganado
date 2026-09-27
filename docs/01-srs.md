# Especificación de Requisitos de Software (SRS)
## Sistema de Gestión y Control de Ganado — "Hato"

Versión 1.1 · Estructura basada en ISO/IEC/IEEE 29148:2018 (sucesora de IEEE 830)
Estado: preguntas abiertas resueltas en `08-dominio-y-finca-referencia.md` con prácticas reales del sector y una finca de referencia ficticia (§9).

---

## 1. Introducción

### 1.1 Propósito
Este documento especifica los requisitos del sistema de gestión y control de ganado bovino para una finca ganadera. Sirve a tres audiencias: el cliente (validación del alcance), el equipo de desarrollo (incluido Claude Code como agente de implementación) y la evaluación académica del proyecto.

### 1.2 Alcance
El sistema reemplaza el registro manual del hato por una plataforma que permite:
- Registrar cada animal desde su nacimiento o ingreso hasta su salida de la finca.
- Identificar animales por múltiples medios (número visual, chapeta oficial DIN, RFID ISO 11784, QR del sistema).
- Clasificar el ganado automáticamente según sexo, edad y estado reproductivo.
- Llevar el control reproductivo, de nacimientos, sanitario (vacunación y tratamientos) y de pesos.
- Llevar una contabilidad básica por animal (inversión, costos, venta, ganancia o pérdida).
- Responder en segundos las preguntas operativas del administrador mediante un tablero y reportes.
- Operar en campo mediante "jornadas de manejo" (fase 2: con soporte sin conexión).

Fuera de alcance en la versión 1: integración directa con SINIGAN V6 del ICA (no se ha verificado que exista una API pública), control de producción de leche, nómina, inventario de insumos, georreferenciación de potreros, identificación biométrica (queda como trabajo de investigación futuro).

### 1.3 Nombre de trabajo
"Hato" es un nombre provisional. Puede cambiarse sin impacto técnico; en el código el producto se referencia como `hato`.

### 1.4 Definiciones y glosario (lenguaje ubicuo)
El código se escribe en inglés y la interfaz en español. Esta tabla es la correspondencia obligatoria entre ambos.

| Término (UI, español) | Identificador en código | Definición |
|---|---|---|
| Finca | `Farm` | Establecimiento ganadero. Todo dato pertenece a una finca (multi-finca preparado desde el diseño). |
| Animal / res | `Animal` | Bovino individual registrado. |
| Código interno | `Animal.code` | Número de manejo de la finca, único por finca. Es el identificador principal en la UI. |
| Identificador | `Identifier` | Cualquier medio de identificación asociado a un animal (visual, DIN, RFID, QR, otro). |
| Chapeta | `Identifier(type=VISUAL_TAG)` | Arete visual con número. |
| DIN | `Identifier(type=DIN)` | Dispositivo de Identificación Nacional del ICA. |
| RFID / chip | `Identifier(type=RFID)` | Código electrónico de 15 dígitos ISO 11784/11785 (FDX-B o HDX). |
| Raza | `Breed` | Catálogo de razas (Brahman, Cebú, Gyr, Holstein, cruces, etc.). |
| Madre | `Animal.damId` | Hembra que parió al animal. |
| Padre | `Animal.sireId` / `sireExternalRef` | Toro de la finca, o referencia externa (pajilla de semen, toro prestado). |
| Servicio | `Pregnancy.serviceDate` | Fecha de monta natural o inseminación. |
| Monta natural / IA | `ServiceMethod.NATURAL` / `ServiceMethod.AI` | Método de reproducción. |
| Preñez | `Pregnancy` | Ciclo reproductivo de una hembra desde el servicio hasta su desenlace. |
| Palpación / diagnóstico | `Pregnancy.confirmedAt` | Confirmación veterinaria de la preñez. |
| Parto | `Pregnancy.outcome = CALVED` | Desenlace con nacimiento de una o más crías. |
| Aborto | `Pregnancy.outcome = ABORTED` | Pérdida de la gestación. |
| Ternero / ternera | categoría derivada `CALF_MALE` / `CALF_FEMALE` | Cría con edad menor a la edad de destete configurada. |
| Novilla | categoría derivada `HEIFER` | Hembra destetada que no ha parido. |
| Vaca | categoría derivada `COW` | Hembra con al menos un parto. |
| Levante | categoría derivada `YOUNG_MALE` | Macho destetado menor de 24 meses. |
| Toro / macho adulto | categoría derivada `ADULT_MALE` | Macho de 24 meses o más. |
| Horra | etiqueta derivada `DRY` | Vaca no preñada ni servida sin cría al pie (último parto hace ≥ edad de destete). |
| Categoría de manejo | `ManagementCategory` | Clasificación exclusiva de cada animal activo (ternero, ternera, novilla, vaca, levante, toro). |
| Ciclo oficial de vacunación | `VaccinationCycle` | Periodo definido por el ICA (dos por año) para vacunar contra aftosa, brucelosis y rabia silvestre. |
| RUV | `VaccinationRecord.ruvNumber` | Registro Único de Vacunación que expide el vacunador de Fedegán. |
| Grupo racial | `Breed.group` | `INDICUS`, `TAURUS` o `CROSS`; determina la gestación por defecto. |
| Destete | `Farm.settings.weaningAgeMonths` | Edad a partir de la cual el animal deja de ser cría (por defecto 7 meses). |
| Parida | etiqueta derivada `CALVED` | Hembra con uno o más partos registrados. |
| Preñada | etiqueta derivada `PREGNANT` | Hembra con preñez abierta confirmada. |
| Servida | etiqueta derivada `SERVED` | Hembra con servicio registrado sin confirmar. |
| Cotero | etiqueta manual `COTERO` | Animal destinado a labores o clasificación específica de la finca (decisión en 08 §1.1). |
| Disponible para venta | `Animal.forSale = true` | Marcado manualmente por el administrador. |
| Salida | `Animal.exitType` | Venta, muerte, sacrificio, robo, traslado u otro. Un animal con salida no cuenta en el inventario. |
| Lote | `Lot` | Grupo de manejo (por potrero, edad o propósito). |
| Vacuna | `Vaccine` | Catálogo de vacunas con intervalo de refuerzo. |
| Vacunación | `VaccinationRecord` | Aplicación de una vacuna a un animal. |
| Tratamiento | `TreatmentRecord` | Aplicación de medicamento con período de retiro. |
| Período de retiro | `TreatmentRecord.withdrawalUntil` | Fecha hasta la cual el animal no debe venderse para consumo. |
| Pesaje | `WeightRecord` | Registro de peso en kg. |
| Gasto | `Expense` | Egreso de dinero, directo a un animal o repartido entre varios. |
| Asignación | `ExpenseAllocation` | Porción de un gasto cargada a un animal. |
| Jornada de manejo | `WorkSession` | Sesión de trabajo en la manga donde se registran eventos animal por animal. |
| Manga / brete | — | Corral estrecho donde se inmoviliza al animal para trabajarlo. |

### 1.5 Referencias
- Ley 914 de 2004 (SINIGAN) y Ley 1659 de 2013 (Colombia).
- Programa IdentifICA y SINIGAN V6 (ICA). Verificar la Resolución 000219 de 2026 en fuente oficial antes de citarla.
- ISO 11784 / ISO 11785: estructura y protocolo de identificación animal por radiofrecuencia.
- Sistema Nacional de Información Ganadera (SNIG), Uruguay: modelo de referencia de doble identificación.
- Enunciado original del proyecto: "Proyecto: Sistema de Gestión y Control de Ganado".

---

## 2. Descripción general

### 2.1 Perspectiva del producto
Sistema nuevo compuesto por una API central y clientes por plataforma (web en fase 1, móvil en fase 2, escritorio en fase 3). Ver `04-arquitectura.md`.

### 2.2 Clases de usuario

| Rol | Código | Descripción | Contexto de uso |
|---|---|---|---|
| Administrador | `ADMIN` | Dueño o administrador de la finca. Toma decisiones, ve la información económica, gestiona usuarios. | Oficina o celular. Conectividad variable. |
| Operario | `OPERATOR` | Vaquero, mayordomo o trabajador de campo. Registra eventos. | Campo, manga, pleno sol, guantes, una mano. Alfabetización digital baja o media. Conectividad pobre o nula. |
| Veterinario | `VET` | Profesional externo o interno. Registra sanidad y reproducción. | Visitas periódicas, jornadas de vacunación y palpación. |

### 2.3 Matriz de permisos

| Acción | ADMIN | OPERATOR | VET |
|---|:-:|:-:|:-:|
| Ver animales, fichas, historial | ✔ | ✔ | ✔ |
| Crear y editar animales | ✔ | ✔ | ✔ |
| Archivar (eliminar lógico) animales | ✔ | ✗ | ✗ |
| Registrar salida (venta, muerte...) | ✔ | ✗ | ✗ |
| Registrar servicio, palpación, parto | ✔ | ✔ | ✔ |
| Registrar vacunación y tratamientos | ✔ | ✔ | ✔ |
| Registrar pesajes | ✔ | ✔ | ✔ |
| Jornadas de manejo | ✔ | ✔ | ✔ |
| Ver y registrar datos económicos | ✔ | ✗ | ✗ |
| Reportes operativos | ✔ | ✔ | ✔ |
| Reportes económicos | ✔ | ✗ | ✗ |
| Configuración y catálogos | ✔ | ✗ | Solo catálogo de vacunas |
| Gestión de usuarios | ✔ | ✗ | ✗ |
| Copias de seguridad y exportación completa | ✔ | ✗ | ✗ |

### 2.4 Restricciones
- R1. La interfaz debe estar en español de Colombia; fechas `dd/mm/aaaa`, moneda COP sin decimales en pantalla, pesos en kg.
- R2. Zona horaria de negocio: `America/Bogota`.
- R3. Debe funcionar en celulares Android de gama media-baja con navegador Chrome.
- R4. Stack tecnológico definido en `04-arquitectura.md` (TypeScript de extremo a extremo).
- R5. Los datos se identifican con UUID generados por el cliente o el servidor (requisito para la sincronización sin conexión de la fase 2).

### 2.5 Supuestos y dependencias
- S1. Una finca inicial con hasta 2.000 animales activos y hasta 10.000 históricos; el sistema debe escalar a 5.000 activos sin cambios de diseño.
- S2. Hasta 10 usuarios concurrentes por finca.
- S3. La finca puede o no tener chapetas oficiales DIN; el sistema no depende de ellas.
- S4. El hardware RFID es opcional. En web se soporta lector en "modo teclado" (HID); la integración Bluetooth completa llega con la app móvil.

---

## 3. Requisitos funcionales

Formato: `ID — Nombre` · Prioridad MoSCoW (M = debe, S = debería, C = podría) · Fase (1 web, 2 móvil, 3 escritorio).
Cada requisito incluye criterios de aceptación verificables (CA). Las reglas de negocio `RN-xx` están en §4.
Alcance **núcleo** (debe estar para el piloto): AUT, ANI, IDN-01 a 03, CLS, REP, NAC, SAN, PES-01/02, RPT, CFG, BAK, AUD. **Completo:** ECO, JOR (web). Ver `08-dominio-y-finca-referencia.md` §4.

### 3.1 Autenticación y usuarios (AUT)

**AUT-01 — Inicio de sesión** · M · F1
El usuario inicia sesión con **nombre de usuario** o correo, y contraseña. El nombre de usuario es obligatorio y el correo opcional, porque los operarios de campo normalmente no tienen correo (08 §1.8).
- CA1: Credenciales válidas → acceso al tablero según su rol.
- CA2: Credenciales inválidas → mensaje "Usuario o contraseña incorrectos" sin revelar cuál falló.
- CA3: Tras 5 intentos fallidos en 15 minutos, la cuenta se bloquea temporalmente 15 minutos. El bloqueo es **por cuenta**: los fallos de un usuario no bloquean a los demás aunque compartan la misma conexión a internet (en la finca todos salen por la misma IP). Desde una misma IP solo aplica el límite de peticiones (ADR-007).
- CA4: La sesión persiste con refresh token (30 días) y se renueva sin pedir credenciales.

**AUT-02 — Cierre de sesión** · M · F1
- CA1: Revoca el refresh token en el servidor.

**AUT-03 — Gestión de usuarios** · M · F1
El ADMIN crea, edita, desactiva usuarios y asigna rol.
- CA1: No se puede desactivar al último ADMIN activo de la finca.
- CA2: Un usuario desactivado no puede iniciar sesión y sus sesiones se revocan.

**AUT-04 — Cambio y restablecimiento de contraseña** · M · F1
- CA1: El usuario cambia su contraseña indicando la actual.
- CA2: El ADMIN puede generar una contraseña temporal para otro usuario, que debe cambiarse en el siguiente inicio de sesión (no depende de correo electrónico, porque la finca puede no tenerlo configurado).
- CA3: Cambiar la contraseña revoca todas las sesiones abiertas del usuario (en cualquier dispositivo) y la respuesta entrega una sesión nueva, de modo que quien la cambió sigue trabajando sin volver a iniciar sesión (ADR-007).

### 3.2 Gestión de animales (ANI)

**ANI-01 — Registrar animal** · M · F1
Campos: código interno (obligatorio, único; para nacidos en la finca se sugiere según `calfCodePattern`, 08 §2.3), nombre (opcional), sexo (obligatorio), raza (obligatorio, del catálogo), fecha de nacimiento (obligatoria; con casilla "fecha aproximada"), peso inicial en kg (opcional; crea un `WeightRecord`), procedencia (`BORN_ON_FARM` o `PURCHASED`; si es comprado: vendedor/origen, fecha de ingreso y valor de compra solo visible para ADMIN), lote (opcional), identificadores adicionales (opcional), foto (opcional, C), observaciones.
- CA1: El sistema rechaza un código interno duplicado dentro de la finca con el mensaje "Ya existe un animal con el código X".
- CA2: Si la procedencia es `PURCHASED` y el usuario es ADMIN, se puede registrar el valor de compra, que crea un `Expense` de tipo `PURCHASE` asignado 100 % al animal.
- CA3: Los animales nacidos en la finca normalmente se crean desde el registro de parto (REP-04), no desde este formulario; el formulario lo permite para cargar el inventario inicial con madre opcional.
- CA4: Al guardar, se muestra la ficha del animal creado.

**ANI-02 — Editar animal** · M · F1
- CA1: Todos los campos de ANI-01 son editables salvo el ID interno del sistema.
- CA2: Cada edición queda en el registro de auditoría (AUD-01) con valores anteriores y nuevos.
- CA3: Un animal con salida registrada solo permite editar observaciones y foto (RN-09).

**ANI-03 — Archivar animal (eliminación lógica)** · M · F1
Cumple el requisito de "eliminación" del enunciado sin perder historial.
- CA1: Solo ADMIN. Requiere motivo (por ejemplo, "registro duplicado por error").
- CA2: El animal archivado desaparece de listados, conteos y reportes, pero puede restaurarse desde Configuración → Archivados.
- CA3: No existe borrado físico desde la interfaz (RN-11).

**ANI-04 — Registrar salida** · M · F1
Tipos: venta, muerte, sacrificio, robo, traslado a otra finca, otro.
- CA1: Solo ADMIN. Requiere fecha y tipo; motivo opcional.
- CA2: Si el tipo es venta, exige precio de venta y comprador (opcional), y crea el ingreso económico correspondiente (ECO-04).
- CA3: Si el animal tiene un período de retiro de medicamento vigente y la salida es venta o sacrificio, se muestra una advertencia que exige confirmación explícita (RN-22).
- CA4: El animal sale del inventario activo y queda con la etiqueta "Vendido" o "Retirado".
- CA5: Se puede revertir una salida registrada por error (solo ADMIN, queda en auditoría).

**ANI-05 — Búsqueda rápida** · M · F1
Un único campo de búsqueda, disponible en toda la aplicación, que acepta: código interno, nombre, número de chapeta visual, DIN, RFID o contenido de un QR del sistema.
- CA1: La búsqueda por coincidencia exacta de cualquier identificador abre directamente la ficha.
- CA2: La búsqueda parcial muestra resultados en menos de 1 segundo con 5.000 animales.
- CA3: Un lector RFID en modo teclado que "escribe" 15 dígitos seguidos de Enter abre la ficha del animal (o ofrece asociar el código si no existe).

**ANI-06 — Listado con filtros** · M · F1
Filtros combinables: sexo, raza, categoría/etiqueta (ternero, ternera, preñada, servida, parida, cotero, disponible para venta), lote, rango de edad, estado (activo, vendido/retirado, archivado), alertas (vacuna vencida, parto próximo, en retiro).
- CA1: Los filtros se reflejan en la URL (se pueden compartir y volver a abrir).
- CA2: El listado muestra: chapeta con código, nombre, sexo, raza, edad legible ("2 a 4 m"), etiquetas, último peso y alertas.
- CA3: Paginación por cursor; ordenable por código, edad y último peso.
- CA4: Exportable a Excel con los filtros aplicados.

**ANI-07 — Ficha del animal (historial individual)** · M · F1
- CA1: Encabezado: código, nombre, identificadores, sexo, raza, edad calculada, etiquetas de clasificación, lote, alertas activas.
- CA2: Secciones: Resumen, Reproducción (solo hembras), Sanidad, Pesos (con gráfica), Genealogía (madre, padre, crías), Costos (solo ADMIN), Historial.
- CA3: El Historial es una línea de tiempo unificada de todos los eventos (nacimiento, ingreso, servicios, partos, vacunas, tratamientos, pesajes, cambios de lote, salida, ediciones relevantes), del más reciente al más antiguo.
- CA4: Acciones rápidas contextuales: "Registrar vacuna", "Registrar peso", "Registrar servicio" / "Registrar parto" (hembras), "Registrar salida" (ADMIN).

**ANI-08 — Edad del animal** · M · F1
- CA1: La edad se calcula en tiempo real desde la fecha de nacimiento; no se almacena (RN-16).
- CA2: Formato: menos de 1 mes en días; menos de 2 años en meses; en adelante "X a Y m". Si la fecha es aproximada se antepone "≈".

**ANI-09 — Importar inventario desde Excel/CSV** · M · F1
Carga inicial (y actualizaciones posteriores) del hato desde una hoja de cálculo. Referente real: módulos de importación de Progan y paso de datos desde Excel de Control Ganadero.
- CA1: El sistema ofrece una **plantilla descargable** (`.xlsx`) con una hoja de instrucciones, una hoja de datos y listas válidas (sexo, raza, lote, procedencia). Referencia: `docs/referencia/plantilla-importacion.xlsx`.
- CA2: Columnas: código (obligatorio), nombre, sexo (obligatorio), raza (obligatoria, debe existir en el catálogo o crearse al confirmar), fecha de nacimiento (obligatoria; acepta `dd/mm/aaaa`), fecha aproximada (sí/no), procedencia, código de la madre, código o referencia del padre, lote, chapeta visual, DIN, RFID, número de partos previos, fecha del último parto, preñada (sí/no), fecha de servicio, último peso (kg), fecha del último peso, observaciones.
- CA3: **Simulación primero:** el archivo se valida sin guardar y se muestra un resumen: filas válidas, filas con advertencias y filas con errores, con el número de fila, la columna y el mensaje (por ejemplo, "Fila 14: la madre 087 es macho").
- CA4: Validaciones: todas las del registro individual (ANI-01, IDN-01) más: códigos duplicados dentro del archivo, madre que debe ser hembra y existir en el archivo o en la finca (se resuelve en dos pasadas), fechas no futuras, madre mayor que la cría, RFID de 15 dígitos, preñada solo si es hembra.
- CA5: Al confirmar, se importan solo las filas válidas en una transacción por lote; las filas con error se descargan en un Excel con una columna "Error" para corregirlas y volver a importar.
- CA6: "Número de partos previos" y "fecha del último parto" crean preñeces históricas cerradas (`CALVED`, marcadas como importadas) para que la clasificación (Vaca, Parida, Horra) sea correcta sin inventar crías. "Preñada = sí" crea una preñez abierta confirmada con la fecha de servicio indicada o estimada.
- CA7: Máximo 5.000 filas por archivo. Solo ADMIN.
- CA8: Queda registrado como lote de importación (archivo, usuario, fecha, filas creadas) en auditoría.

### 3.3 Identificación (IDN)

**IDN-01 — Múltiples identificadores por animal** · M · F1
Tipos: `VISUAL_TAG`, `DIN`, `RFID`, `QR`, `BRAND` (hierro/marca), `OTHER`.
- CA1: Un animal puede tener varios identificadores activos de distinto tipo.
- CA2: Un valor de identificador activo es único por finca y tipo (RN-19).
- CA3: El RFID se valida como 15 dígitos numéricos (ISO 11784). Si no empieza por `170` (Colombia) se muestra una advertencia (animal importado), sin bloquear.
- CA4: El DIN se guarda normalizado (mayúsculas, sin espacios ni guiones), sin patrón estricto hasta verificar el formato oficial vigente (08 §1.6).

**IDN-02 — Reemplazo por pérdida o daño** · M · F1
- CA1: Al reemplazar un identificador se registra motivo (pérdida, daño, reasignación oficial), fecha y el nuevo valor.
- CA2: El identificador anterior queda inactivo pero visible en el historial y sigue siendo buscable (la búsqueda indica "identificador anterior").

**IDN-03 — QR del sistema** · S · F1
- CA1: Cada animal tiene un QR que codifica una URL `https://<dominio>/a/<uuid>` que abre su ficha tras iniciar sesión.
- CA2: El ADMIN puede imprimir etiquetas QR en lote (hoja A4 con cuadrícula configurable, mostrando código y QR) para tarjetas de manejo o fichas de potrero.
- CA3: El QR no expone datos del animal sin autenticación.

**IDN-04 — Lectura RFID por Bluetooth** · S · F2
- CA1: La app móvil se empareja con lectores RFID Bluetooth compatibles y recibe lecturas FDX-B/HDX.
- CA2: Cada lectura abre la ficha o avanza la jornada de manejo.

**IDN-05 — Lectura de chapeta por cámara (OCR)** · C · F2
- CA1: La app móvil reconoce el número impreso de la chapeta y propone coincidencias; el usuario confirma antes de abrir la ficha.

### 3.4 Clasificación del ganado (CLS)

**CLS-01 — Clasificación automática** · M · F1
El sistema calcula para cada animal activo (08 §2.1):
- Una **categoría de manejo** exclusiva: `CALF_MALE` Ternero, `CALF_FEMALE` Ternera, `HEIFER` Novilla, `COW` Vaca, `YOUNG_MALE` Levante, `ADULT_MALE` Toro / macho adulto (RN-06).
- **Etiquetas derivadas** combinables: `SERVED` Servida, `PREGNANT` Preñada, `CALVED` Parida (n partos), `DRY` Horra, `WITHDRAWAL` En retiro (RN-07, RN-08, RN-25).
- CA1: Categorías y etiquetas derivadas no se editan a mano; cambian cuando cambian los datos que las originan.
- CA2: Una hembra puede tener varias etiquetas a la vez (por ejemplo, Vaca + Parida · 4 + Preñada).

**CLS-02 — Clasificación manual** · M · F1
Etiquetas manuales: `COTERO` y "Disponible para venta" (`forSale`). La finca puede definir etiquetas adicionales (C).
- CA1: Solo ADMIN marca "Disponible para venta".
- CA2: Las etiquetas manuales se pueden aplicar en lote desde el listado (selección múltiple).

**CLS-03 — Estado de salida** · M · F1
- CA1: Animales con salida se muestran como "Vendido" (venta) o "Retirado" (demás tipos) y se excluyen del inventario activo.

### 3.5 Control reproductivo (REP)

**REP-01 — Registrar servicio** · M · F1
Campos: hembra, fecha de servicio, método (monta natural / IA), toro (animal de la finca, opcional) o referencia externa (pajilla, toro prestado), responsable, observaciones.
- CA1: Solo hembras activas en edad reproductiva mínima configurable (advertencia, no bloqueo, RN-15).
- CA2: Calcula y muestra la fecha estimada de parto con la gestación de la raza de la madre (RN-04).
- CA3: Rechaza el registro si la hembra ya tiene una preñez abierta (RN-03), con opción de ir a cerrarla.

**REP-02 — Confirmar o descartar preñez (palpación)** · M · F1
- CA1: Registra fecha de diagnóstico, resultado (positivo/negativo), responsable.
- CA2: Positivo → etiqueta Preñada. Negativo → la preñez se cierra con desenlace `FAILED` (vacía).
- CA3: Permite registrar preñez confirmada sin servicio conocido: el usuario indica meses de gestación estimados y el sistema calcula la fecha de servicio estimada.

**REP-03 — Registrar aborto** · M · F1
- CA1: Cierra la preñez con desenlace `ABORTED`, fecha y observaciones. No crea crías ni cuenta como parto.

**REP-04 — Registrar parto** · M · F1
Campos: hembra (con preñez abierta, o sin ella para partos no registrados previamente), fecha real de parto, tipo (normal, asistido, cesárea), observaciones del parto, y por cada cría: código interno, sexo, peso al nacer, estado de salud (sana, débil, muerta al nacer), identificadores opcionales.
- CA1: Cierra la preñez con desenlace `CALVED` (si no había preñez abierta, crea una cerrada con fecha de servicio estimada).
- CA2: Crea automáticamente el registro de cada cría viva (RN-05): madre = la hembra; padre = el de la preñez; raza propuesta = la de la madre (editable, admite "cruce"); fecha de nacimiento = fecha de parto; procedencia = nacido en la finca; lote = el de la madre; peso al nacer como primer pesaje.
- CA3: Soporta mellizos (1 a 3 crías por parto).
- CA4: Una cría muerta al nacer se registra en el parto (cuenta para estadística) pero no crea animal activo.
- CA5: Todo el registro (cierre de preñez + crías + pesajes) es una única transacción: o se guarda todo o nada.
- CA6: Al terminar muestra la ficha de la madre con las crías nuevas enlazadas.

**REP-05 — Historial reproductivo de la hembra** · M · F1
- CA1: En la ficha: número de partos (derivado), fecha del último parto, intervalo entre partos en días (derivado), preñez actual con días de gestación y fecha estimada de parto, lista de todas las preñeces con su desenlace.

### 3.6 Nacimientos (NAC)

**NAC-01 — Consulta de nacimientos** · M · F1
- CA1: Reporte de nacimientos por período (rango de fechas) con totales por sexo, vivos y muertos al nacer.
- CA2: Listado detallado: código de la cría, sexo, fecha, código de la madre, padre si se conoce, raza, peso al nacer, estado de salud.
- CA3: Responde "¿cuál es la madre de este ternero?" desde la ficha (Genealogía) y desde el listado.

### 3.7 Sanidad (SAN)

**SAN-01 — Catálogo de vacunas** · M · F1
Campos: nombre comercial, enfermedad o propósito, dosis por defecto, vía de aplicación, **tipo de programación** (`OFFICIAL_CYCLE`, `AGE_WINDOW`, `INTERVAL`, `NONE`), intervalo de refuerzo en días (solo `INTERVAL`), elegibilidad opcional (sexo, edad mínima y máxima en días), bloqueo en sexo no elegible (sí/no), activa/inactiva (08 §1.5).
- CA1: ADMIN y VET gestionan el catálogo. Semilla con el plan oficial real (aftosa y rabia por ciclo; brucelosis en hembras de 90 a 270 días, bloqueada en machos) y una vacuna de intervalo de ejemplo.

**SAN-02 — Registrar vacunación individual** · M · F1
Campos: animal, vacuna, fecha, dosis aplicada, lote/serie del biológico (opcional), número de RUV (opcional), veterinario o responsable, próxima fecha (solo vacunas `INTERVAL`; propuesta automáticamente, editable), observaciones.
- CA1: La próxima fecha se propone como fecha + intervalo de la vacuna (RN-12).
- CA2: Si la vacuna bloquea el sexo no elegible (brucelosis en machos), el registro se rechaza con el mensaje "La vacuna contra brucelosis no se aplica a machos" (RN-26).

**SAN-03 — Registrar vacunación masiva** · M · F1
- CA1: El usuario elige vacuna, fecha, responsable y selecciona animales por filtros (lote, categoría, todos) o por lectura sucesiva de identificadores.
- CA2: Muestra el conteo antes de confirmar y crea un registro por animal en una sola transacción.
- CA3: Permite excluir animales individuales de la selección.

**SAN-04 — Alertas de vacunación** · M · F1
- CA1: Lista de vacunas pendientes y vencidas por animal y vacuna, calculadas según el tipo de programación (RN-13): ciclo oficial en curso o cerrado sin aplicación; ventana de edad (por ejemplo, terneras de 3 a 9 meses sin brucelosis); intervalo vencido o próximo (ventana configurable, por defecto 15 días).
- CA2: Visible en el tablero, en la ficha del animal y como filtro del listado.
- CA3: Desde la alerta se puede registrar la vacunación directamente.

**SAN-05 — Registrar tratamiento** · S · F1
Campos: animal, fecha, diagnóstico o motivo, medicamento, dosis, días de tratamiento, días de retiro (carne y leche), responsable, costo (solo ADMIN, crea gasto), observaciones.
- CA1: Calcula la fecha de fin de retiro; mientras esté vigente, el animal muestra la alerta "En retiro hasta dd/mm".

**SAN-06 — Ciclos oficiales de vacunación** · M · F1
- CA1: El ADMIN registra los ciclos oficiales (nombre, fecha de inicio y de fin) y qué vacunas aplican en ellos. Se entregan precargados los ciclos 2025-2 y 2026-1 reales (08 §3.3).
- CA2: Durante un ciclo abierto, el tablero muestra "Ciclo 2026-2: 212 de 284 vacunados contra aftosa" y el listado de pendientes.
- CA3: Desde un ciclo se puede iniciar una vacunación masiva o una jornada con las vacunas del ciclo.

### 3.8 Pesos (PES)

**PES-01 — Registrar pesaje** · M · F1
- CA1: Individual o dentro de una jornada. Campos: animal, fecha, peso en kg, método (báscula, cinta, estimado), observaciones.
- CA2: Advierte si el peso difiere más de 30 % del último registro (posible error de digitación), sin bloquear.

**PES-02 — Evolución de peso** · M · F1
- CA1: Gráfica de peso en el tiempo en la ficha; ganancia diaria promedio (kg/día) entre los dos últimos pesajes y desde el nacimiento.

**PES-03 — Báscula Bluetooth** · C · F3
- CA1: En la jornada, el peso se captura de la báscula y se asocia al animal leído.

### 3.9 Contabilidad básica (ECO) — solo ADMIN

**ECO-01 — Registrar gasto directo** · M · F1
Tipos: compra, alimentación, medicamentos, vacunas, veterinario, transporte, otro. Campos: fecha, tipo, monto COP, descripción, animal.
- CA1: El gasto se asigna 100 % al animal.

**ECO-02 — Registrar gasto compartido** · M · F1
Ejemplo: un bulto de sal mineralizada para todo el lote.
- CA1: El usuario elige los animales (por lote, filtro o selección) y el método de reparto: partes iguales (F1) o proporcional al peso (S).
- CA2: El sistema crea una asignación por animal cuya suma es exactamente el monto total (el residuo por redondeo se asigna al primer animal, RN-17).

**ECO-03 — Valor estimado actual** · S · F1
- CA1: El ADMIN registra un avalúo por animal (fecha y valor). También puede calcularse como último peso × precio por kg configurado por categoría.

**ECO-04 — Venta** · M · F1
- CA1: Se registra desde ANI-04. Crea un ingreso con fecha, valor y comprador.

**ECO-05 — Resultado por animal** · M · F1
- CA1: En la ficha (sección Costos): inversión total = compra + gastos directos + asignaciones; valor estimado; valor de venta si aplica; ganancia o pérdida = venta − inversión (RN-18).
- CA2: Desglose por tipo de gasto.

**ECO-06 — Reporte económico** · S · F1
- CA1: Inversión total del hato, por categoría y por período; ventas del período; resultado de animales vendidos en el período.

### 3.10 Jornadas de manejo (JOR)

**JOR-01 — Crear jornada** · S · F1 (web) · M · F2 (móvil)
- CA1: El usuario define nombre, fecha, lote o selección de animales esperados (opcional) y las actividades de la jornada: vacunación (con vacuna), pesaje, palpación, tratamiento, cambio de lote, marcar etiqueta.

**JOR-02 — Trabajar la jornada** · S · F1 · M · F2
- CA1: Pantalla de flujo: el usuario busca o lee el identificador del animal; se muestra una tarjeta resumen (código, edad, categoría, alertas activas) y los campos de las actividades configuradas con valores por defecto; un toque guarda y deja listo el siguiente animal.
- CA2: Si el animal ya fue trabajado en la jornada, se advierte.
- CA3: Contador visible de animales trabajados / esperados.

**JOR-03 — Cerrar jornada** · S · F1
- CA1: Resumen: animales trabajados, animales esperados no trabajados, alertas encontradas, eventos creados. Exportable.

### 3.11 Tablero, reportes y consultas (RPT)

**RPT-01 — Tablero del administrador** · M · F1
Responde las preguntas de la situación problema del enunciado:
- Total de animales activos, con desglose machos/hembras.
- Terneros y terneras.
- Hembras preñadas y servidas sin confirmar.
- Partos próximos (ventana configurable, por defecto 30 días) con lista de hembras.
- Nacimientos del año en curso por sexo.
- Vacunas vencidas y próximas a vencer.
- Animales disponibles para venta.
- (Solo ADMIN) Inversión total del hato activo.
- CA1: Cada indicador es un enlace al listado filtrado correspondiente.
- CA2: Carga en menos de 2 segundos con 5.000 animales.

**RPT-02 — Reportes estándar** · M · F1
Inventario (total, por sexo, por categoría de manejo, por raza, por lote); **inventario por grupos de edad en formato ICA** (08 §2.2); avance del ciclo oficial de vacunación; nacimientos por período; vacunados por período y vacuna; pendientes de vacunación; partos próximos; vendidos o retirados por período; historial individual (PDF de la ficha).
- CA1: Todos exportables a Excel. Historial individual exportable a PDF (S).

**RPT-03 — Gráficas estadísticas** · S · F1
- CA1: Evolución del inventario por mes, nacimientos por mes y sexo, distribución por categoría.

### 3.12 Configuración (CFG)

**CFG-01 — Parámetros de la finca** · M · F1
Nombre, ubicación (municipio, departamento), código de predio ICA (opcional), días de gestación por defecto de la finca (285; la raza puede tener su propio valor), edad de destete en meses (7), edad mínima reproductiva en meses (15), ventana de alerta de parto (30 días), ventana de alerta de vacunas (15 días), patrón del código de crías (`{YY}-{NNN}`), zona de riesgo de rabia silvestre (sí/no).
- CA1: Cambiar un parámetro recalcula las clasificaciones derivadas (son calculadas, no almacenadas).

**CFG-02 — Catálogos** · M · F1
Razas (con grupo racial y días de gestación), vacunas, ciclos oficiales de vacunación, lotes y etiquetas manuales (M3). Los **tipos de gasto** pasan a M7 (Finanzas), donde se usan; hoy son un enum fijo (`EXPENSE_TYPE`).
- CA1: Los catálogos no se borran: se desactivan, dejan de ofrecerse en los formularios y conservan su historial.
- CA2: Los nombres son únicos por finca sin distinguir mayúsculas ni espacios sobrantes («Brahman» y «brahman » son el mismo).
- CA3: Desactivar algo en uso (un lote con animales activos, una vacuna de un ciclo en curso o futuro) se advierte antes de confirmar, sin bloquear.

### 3.13 Copias de seguridad y exportación (BAK)

**BAK-01 — Copia automática** · M · F1
- CA1: Respaldo completo diario de la base de datos, cifrado, almacenado fuera del servidor, con retención de 7 diarios, 4 semanales y 6 mensuales.
- CA2: Procedimiento de restauración documentado y probado al menos una vez antes de salir a producción.

**BAK-02 — Exportación por el usuario** · M · F1
- CA1: El ADMIN descarga todos los datos de la finca en un archivo Excel (una hoja por entidad) o CSV comprimido.

### 3.14 Auditoría (AUD)

**AUD-01 — Registro de auditoría** · M · F1
- CA1: Toda creación, edición, archivo, salida y reversión guarda: usuario, fecha y hora, entidad, ID, acción y diferencias.
- CA2: El ADMIN consulta la auditoría por animal (en la ficha) y general (en Configuración).

### 3.15 Sincronización sin conexión (SYN) — Fase 2

**SYN-01 — Operación sin conexión en la app móvil** · M · F2
- CA1: La app descarga los datos de la finca y permite consultar fichas, registrar eventos y trabajar jornadas sin conexión.
- CA2: Los cambios se envían automáticamente al recuperar conexión; se muestra el estado ("3 cambios pendientes de enviar").
- CA3: Los conflictos se resuelven según RN-24 y se informan al usuario cuando afectan datos que él modificó.

---

## 4. Reglas de negocio

| ID | Regla |
|---|---|
| RN-01 | El código interno es obligatorio y único por finca entre animales no archivados. |
| RN-02 | Solo hembras pueden tener servicios, preñeces, partos y abortos. Solo machos pueden ser toros padres internos. |
| RN-03 | Una hembra no puede tener más de una preñez abierta (desenlace `PENDING`). |
| RN-04 | Fecha estimada de parto = fecha de servicio + días de gestación de la **raza de la madre** (`Breed.gestationDays`) o, si no tiene, de la finca (defecto 285). Se recalcula si cambia la fecha de servicio. |
| RN-05 | Un parto con cría viva crea un animal: madre = hembra, padre = el de la preñez, fecha de nacimiento = fecha de parto, procedencia = nacido en la finca, lote = el de la madre, peso al nacer = primer pesaje. |
| RN-06 | Categoría de manejo (exclusiva): edad < destete → Ternero/Ternera según sexo; hembra ≥ destete sin partos → Novilla; hembra con ≥ 1 parto → Vaca; macho ≥ destete y < 24 meses → Levante; macho ≥ 24 meses → Toro / macho adulto. |
| RN-07 | Parida: hembra con al menos una preñez con desenlace `CALVED`. El número de partos es el conteo de esas preñeces (derivado, no almacenado). |
| RN-08 | Preñada: hembra con preñez `PENDING` y `confirmedAt` no nulo. Servida: preñez `PENDING` sin confirmar. Si pasan más de 90 días desde el servicio sin confirmación, se genera la alerta "Servida sin diagnóstico". |
| RN-09 | Un animal con salida no admite nuevos eventos ni ediciones, salvo observaciones y foto, hasta que se revierta la salida. |
| RN-10 | Una salida por venta exige precio de venta y genera el ingreso correspondiente. |
| RN-11 | No hay borrado físico de datos de negocio desde la aplicación. Archivar = `deletedAt` + motivo. Los eventos erróneos se anulan (`voidedAt` + motivo), no se borran. |
| RN-12 | Solo para vacunas `INTERVAL`: próxima fecha = fecha de aplicación + intervalo; editable por el usuario. |
| RN-13 | Pendiente/vencida según el tipo: **`OFFICIAL_CYCLE`**: animal activo elegible sin aplicación de esa vacuna entre inicio y fin del ciclo en curso → pendiente; del último ciclo cerrado → vencida. **No aplica** (ni pendiente ni vencida) si el animal no estaba en la finca cuando el ciclo cerró, es decir si `max(fecha de nacimiento, fecha de ingreso) > fin del ciclo`: una cría nacida después del cierre o un animal comprado después no pudieron vacunarse en ese ciclo (el día del cierre sí cuenta como estar en la finca). Ver `docs/adr/004-elegibilidad-en-ciclos-oficiales.md`. **`AGE_WINDOW`**: animal elegible por sexo, dentro de la ventana de edad y sin ninguna aplicación → pendiente; pasó la edad máxima sin aplicación → vencida ("fuera de edad"). **`INTERVAL`**: próxima fecha ≤ hoy + ventana → próxima; < hoy → vencida. Un registro posterior válido resuelve la alerta. Registros anulados no cuentan. |
| RN-14 | Las fechas de eventos no pueden ser futuras, excepto las fechas estimadas o programadas. Ningún evento puede ser anterior a la fecha de nacimiento del animal. |
| RN-15 | Un servicio en una hembra menor a la edad mínima reproductiva genera advertencia, no bloqueo. |
| RN-16 | La edad y las clasificaciones derivadas se calculan, nunca se almacenan. |
| RN-17 | La suma de las asignaciones de un gasto compartido es exactamente igual al monto del gasto; el residuo de redondeo se suma a la primera asignación. |
| RN-18 | Inversión por animal = suma de asignaciones de gastos (incluida la compra). Resultado = valor de venta − inversión. Los gastos anulados no cuentan. |
| RN-19 | Un valor de identificador activo es único por finca y tipo. Un identificador reemplazado queda inactivo y no se reutiliza para otro animal sin confirmación del ADMIN. |
| RN-20 | Los datos económicos (gastos, asignaciones, valores, ventas, inversión) solo son visibles y editables por ADMIN, tanto en la interfaz como en la API. |
| RN-21 | Todo dato de negocio pertenece a una finca; ningún usuario accede a datos de una finca a la que no pertenece. |
| RN-22 | Vender o sacrificar un animal en período de retiro exige confirmación explícita y queda registrado en auditoría. |
| RN-23 | Una cría no puede tener fecha de nacimiento anterior a la de su madre + edad mínima reproductiva (advertencia). |
| RN-24 | Sincronización (F2): los eventos son de solo adición y no generan conflicto. Para datos editables (ficha del animal) gana la última escritura por registro, se conserva la versión perdida en auditoría y se notifica. |
| RN-25 | Horra: vaca (categoría `COW`) sin preñez abierta y cuyo último parto fue hace ≥ edad de destete. |
| RN-26 | Una vacuna con `blockIneligibleSex = true` no puede registrarse en animales del sexo no elegible (brucelosis en machos, norma ICA). La elegibilidad por edad solo genera advertencia. |
| RN-27 | La categoría de manejo y las etiquetas se calculan con las mismas funciones de `packages/shared/src/domain` en tablero, listados, reportes e importación. |
| RN-28 | Los códigos sugeridos con `calfCodePattern` nunca reutilizan un código existente (activo o archivado) de la finca. |
| RN-29 | La importación nunca crea crías a partir de "número de partos previos": crea preñeces históricas cerradas marcadas como importadas. |

---

## 5. Requisitos no funcionales

| ID | Categoría | Requisito | Verificación |
|---|---|---|---|
| RNF-01 | Rendimiento | Búsqueda < 1 s y tablero < 2 s (p95) con 5.000 animales activos y 50.000 eventos. | Prueba con datos sintéticos (seed de carga). |
| RNF-02 | Rendimiento | Primera carga de la web < 3 s en 4G lenta; bundle inicial < 250 KB gzip. | Lighthouse. |
| RNF-03 | Usabilidad | Un operario nuevo registra una vacunación sin ayuda en menos de 1 minuto tras una demostración de 5 minutos. | Prueba de usabilidad con 3 usuarios reales. |
| RNF-04 | Usabilidad | Objetivos táctiles ≥ 48 × 48 px; contraste legible a pleno sol (≥ 7:1 en texto principal). | Revisión de diseño + WCAG. |
| RNF-05 | Accesibilidad | WCAG 2.1 nivel AA en la web. | axe-core en pruebas E2E. |
| RNF-06 | Seguridad | Contraseñas con Argon2id; HTTPS obligatorio; tokens de acceso de 15 min; refresh tokens rotados y revocables; limitación de intentos en login. | Pruebas de integración. |
| RNF-07 | Seguridad | Autorización verificada en el servidor para cada endpoint (rol + finca). La interfaz ocultando botones no cuenta como control. | Pruebas de autorización por rol. |
| RNF-08 | Seguridad | Alineado con OWASP ASVS nivel 1. Sin secretos en el repositorio. | Checklist + escaneo de secretos en CI. |
| RNF-09 | Disponibilidad | 99 % mensual en horario 5:00–21:00. | Monitoreo de salud. |
| RNF-10 | Recuperación | RPO ≤ 24 h, RTO ≤ 4 h. | Simulacro de restauración. |
| RNF-11 | Mantenibilidad | TypeScript estricto; lint y formato automáticos; cobertura ≥ 80 % en el módulo de dominio (reglas de negocio). | CI. |
| RNF-12 | Portabilidad | Web en Chrome, Edge, Firefox y Safari recientes; Android 9+ para la app móvil (F2). | Pruebas E2E en navegadores. |
| RNF-13 | Localización | es-CO: fechas `dd/mm/aaaa`, separador de miles con punto, COP sin decimales. | Pruebas de formato. |
| RNF-14 | Trazabilidad | Auditoría de todas las escrituras (AUD-01). | Pruebas. |
| RNF-15 | Escalabilidad | Diseño multi-finca desde el inicio (`farmId` en todas las tablas de negocio). | Revisión de esquema. |
| RNF-16 | Conectividad | F2: operación completa sin conexión en móvil. F1: la web muestra un aviso claro al perder conexión y no pierde lo que el usuario estaba escribiendo. | Pruebas manuales. |

---

## 6. Interfaces externas

- **Usuario:** ver `06-ux-ui.md`.
- **Hardware:** lector RFID en modo teclado (F1); lector RFID Bluetooth y cámara (F2); báscula Bluetooth (F3).
- **Software:** PostgreSQL; almacenamiento de objetos compatible con S3 para respaldos y fotos.
- **Comunicación:** API REST JSON sobre HTTPS. Ver `05-api.md`.

---

## 7. Casos de uso principales

### CU-01 Registrar parto
Actor: Operario, Veterinario o Administrador.
Precondición: la hembra existe, está activa y es hembra.
1. El actor busca la hembra y elige "Registrar parto".
2. El sistema muestra la preñez abierta (si existe) con la fecha estimada.
3. El actor indica fecha, tipo de parto, número de crías y, por cada una, código, sexo, peso y estado.
4. El sistema valida (RN-02, RN-14, código único) y guarda todo en una transacción.
5. El sistema muestra la ficha de la madre con las crías enlazadas.
Alternativas: 2a. No hay preñez abierta → se crea una preñez cerrada con servicio estimado. 3a. Cría muerta al nacer → no se crea animal. 4a. Código duplicado → se marca el campo y no se guarda nada.

### CU-02 Trabajar una jornada de vacunación
Actor: Operario.
1. El actor crea la jornada "Vacunación aftosa – lote Sabana" con actividad vacunación.
2. Por cada animal que entra a la manga, lee o escribe el identificador.
3. El sistema muestra la tarjeta del animal con alertas y la vacuna preconfigurada.
4. El actor toca "Guardar y siguiente".
5. Al terminar, el actor cierra la jornada y revisa los animales faltantes.
Alternativas: 3a. Identificador desconocido → opción de asociarlo a un animal existente o crear uno nuevo. 3b. Animal ya vacunado en la jornada → advertencia.

### CU-03 Consultar animales próximos a parir
Actor: Administrador.
1. En el tablero toca el indicador "Partos próximos".
2. El sistema muestra el listado filtrado y ordenado por fecha estimada de parto, con días restantes y lote.

### CU-04 Vender un animal
Actor: Administrador.
1. Desde la ficha elige "Registrar salida" → Venta.
2. Indica fecha, precio y comprador.
3. El sistema advierte si hay retiro vigente (RN-22), guarda la salida y el ingreso, y muestra el resultado económico del animal.

---

## 8. Trazabilidad con el enunciado

| Sección del enunciado | Requisitos |
|---|---|
| 1. Registro de animales | ANI-01, ANI-02, ANI-09, IDN-01 |
| 2. Clasificación del ganado | CLS-01, CLS-02, CLS-03 |
| 3. Control reproductivo | REP-01 a REP-05 |
| 4. Control de nacimientos | REP-04, NAC-01 |
| 5. Control de vacunación | SAN-01 a SAN-04, SAN-06 |
| 6. Consultas y reportes | RPT-01, RPT-02, RPT-03, ANI-07 |
| 7. Contabilidad básica | ECO-01 a ECO-06 |
| 8. Funciones adicionales | AUT-01 a AUT-04, ANI-03, ANI-05, ANI-06, ANI-07, BAK-01, BAK-02 |
| Situación problema (preguntas) | RPT-01 |
| Valor agregado (investigación) | IDN-02 a IDN-05, JOR-01 a JOR-03, SAN-05, PES-01 a PES-03, AUD-01, SYN-01 |

---

## 9. Preguntas abiertas: resueltas

Las 11 preguntas de la versión 1.0 se resolvieron en `08-dominio-y-finca-referencia.md` §1 con prácticas y normas reales (destete, gestación por raza, plan oficial de vacunación, formato DIN, categorías del ICA) y con una **finca de referencia ficticia** para lo que depende de una finca concreta (usuarios, identificación en uso, conectividad, lotes, gastos). Al validar con la finca real se ajusta la configuración y el seed; el código no cambia.
