// dotenv no sobrescribe lo que ya está definido: en la integración continua mandan las
// variables del workflow y en local, el .env del desarrollador.
import 'dotenv/config';

import { applyTestEnv } from './test-env.js';

// Se ejecuta antes de que el archivo de prueba importe cualquier módulo, así que el entorno ya
// está listo cuando `EnvModule` lo valida.
applyTestEnv();
