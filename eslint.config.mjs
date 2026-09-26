import { hato } from '@hato/config/eslint';

// Una sola configuración para todo el monorepo: `projectService` resuelve el tsconfig
// de cada archivo según el paquete al que pertenece.
export default hato({ tsconfigRootDir: import.meta.dirname });
