# ADR-011: Importación del inventario — seguridad del archivo e idempotencia

- Estado: aceptada (M4d)
- Requisitos: ANI-09, RN-29, RN-30, RN-31, RNF-06
- Relacionadas: ADR-007 (sesiones), ADR-009 (clasificación en SQL)

## Contexto

La importación desde Excel o CSV (ANI-09) es la única entrada de archivos de la API: un ADMIN sube
una hoja de hasta 5.000 animales que la API lee, valida y escribe. Un archivo así es una superficie
de ataque (bombas de descompresión, rutas que salen de la carpeta, macros, fórmulas) y una fuente
de errores de uso (el doble clic que importa dos veces, la simulación que ya no coincide con lo que
se confirma).

La librería para leer y escribir Excel es `exceljs` (MIT). El paquete `xlsx` de npm no se usa: su
versión publicada está abandonada y tiene vulnerabilidades conocidas. `exceljs` 4.4.0 tiene dos
límites que obligan a esta decisión:

1. `workbook.xlsx.load` descomprime todas las entradas con JSZip **sin límite** y no ofrece cómo
   ponérselo: un `.xlsx` de 5 MB puede inflarse a gigabytes.
2. Solo abre bien los libros tal como los escribe Excel. Con rutas absolutas en las relaciones
   (`Target="/xl/…"`, válidas en el estándar OPC) o comentarios fuera de `xl/commentsN.xml` (así
   los guarda openpyxl, con el que se armó `docs/referencia/plantilla-importacion.xlsx`), se cae.

`exceljs` depende de `uuid` 8, con un aviso moderado (GHSA-w5hq-g745-h8pq, solo en v3/v5/v6 con
`buf`); `exceljs` usa solo `v4`. Aun así se fuerza `uuid` ≥ 11.1.1 con un `override` de pnpm y el
audit queda limpio para las dependencias nuevas.

## Decisión

### Archivo

- Solo `.xlsx` y `.csv`, con un máximo de 5 MB (límite de `@fastify/multipart`, un archivo y pocos
  campos cortos, en memoria: nada va a disco) y 5.000 filas de datos.
- El tipo se comprueba por el **contenido**: un `.xlsx` tiene que empezar con la firma ZIP y
  declarar el tipo de contenido de una hoja sin macros; un `.csv` no puede tener bytes NUL ni la
  firma de un binario (Office antiguo, PDF, ejecutable, imagen). `.xlsm` se rechaza por extensión,
  por tipo MIME y por contenido (`vbaProject.bin` o `macroEnabled`), aunque se renombre.
- Un **lector propio y pequeño del directorio central del ZIP** (`imports/zip-guard.ts`, con sus
  pruebas) rechaza entradas cifradas, ZIP64, métodos distintos de guardado y deflate, nombres
  repetidos y nombres que intentan salir de la carpeta (`../`, absolutos, `\`, unidades, NUL), y
  **descomprime cada entrada de verdad** con `inflateRawSync({ maxOutputLength })` contra un
  presupuesto total de 50 MB. El presupuesto se descuenta con los **bytes reales** que produce
  la descompresión de cada entrada (y `maxOutputLength` es el presupuesto que queda, así que la
  descompresión se corta en cuanto lo pasa); el tamaño que declara el ZIP ni siquiera se lee.
  No se cuenta con ese tamaño, que puede mentir, ni con que dos entradas no compartan datos: la
  prueba de la bomba declara 10 bytes y se corta igual.
- Lo ya medido se sanea para `exceljs` (`imports/xlsx-sanitize.ts`: rutas relativas, sin comentarios
  ni dibujos VML, que la importación no necesita) y se **vuelve a empaquetar sin compresión**. Eso
  es lo único que recibe `exceljs`: no tiene nada que inflar y abre exactamente lo que se midió.
- De las fórmulas se usa el **valor guardado**; nunca se evalúan (`exceljs` no calcula). Una
  fórmula sin valor guardado es un error de la fila.
- El CSV se decodifica como UTF-8 (con o sin BOM) y, si no lo es, como Windows-1252, que es lo que
  guarda Excel en Windows; el separador (`;`, `,` o tabulador) sale de la fila de encabezados.
- Todo archivo que la API genera (plantilla, filas con error, exportación del listado) antepone un
  apóstrofo al texto que empieza por `=`, `+`, `-`, `@`, tabulador o retorno.

### Validación

- Las reglas puras viven en `packages/shared/src/domain/animal-import.ts`, en dos pasos con la base
  en medio: primero cada fila y los repetidos del archivo; después, con lo que la API averiguó
  (código ocupado con `assertCodeAvailable`, identificadores con `checkIdentifier`, animales de la
  finca por código), madre y padre y el plan de escritura. Así la importación no escribe otra
  verificación de códigos: usa la misma, con el mismo candado, que el registro individual.
- La simulación y la confirmación corren la misma validación. La confirmación la vuelve a correr
  **dentro** de la transacción que escribe (hasta 60 s), así que entra lo que es verdad en ese
  momento, todo o nada.

### Una sola vez

- La web genera una **clave de idempotencia** (UUIDv7) cada vez que se elige un archivo y la manda
  al confirmar. `import_batches` tiene un índice único por (`farm_id`, `idempotency_key`). Antes de
  escribir se toma un candado consultivo por finca y se busca la clave: si ya existe, se responde el
  lote de antes (`replayed: true`, 200) sin importar nada. El índice único respalda el caso en que
  aun así dos confirmaciones pasen.
- Se guarda además la huella SHA-256 del archivo. No bloquea nada: la simulación la usa para avisar
  «Este archivo ya se importó el …».
- La confirmación manda `expectedRows`, el número que mostró la simulación. Si al confirmar el
  resultado es otro (alguien registró uno de esos códigos entretanto), responde `VERSION_CONFLICT`
  y no importa nada.

## Alternativas descartadas

- **Solo el hash del archivo como clave.** Impediría reimportar a propósito el mismo archivo después
  de, por ejemplo, crear el lote que faltaba: las filas que antes tenían error ya serían válidas.
  La clave por archivo elegido distingue el doble clic del reintento deliberado.
- **Guardar la simulación en el servidor y confirmar por su id.** Obliga a guardar archivos o
  resultados con vencimiento. Volver a subir el archivo y revalidar es más simple y siempre refleja
  el estado real de la finca.
- **Confiar en los tamaños declarados del ZIP** o en un límite solo de tamaño comprimido: una bomba
  declara tamaños falsos y 5 MB comprimidos pueden ser gigabytes.
- **Evaluar fórmulas** (con otra librería): no hace falta y abre la puerta a comportamientos del
  archivo que la importación no controla.

## Consecuencias

- La importación es desde la web y solo para ADMIN; el móvil (F2) no importa archivos.
- Si `exceljs` publica una versión que acepte un límite de descompresión o las rutas absolutas, el
  saneamiento puede simplificarse; el lector propio del ZIP se mantiene como defensa.
- 5.000 filas válidas se confirman en unos 21 s en una máquina de desarrollo, lejos del máximo de
  60 s; lo cubre una prueba de integración.
