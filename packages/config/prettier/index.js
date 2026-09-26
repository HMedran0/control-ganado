/**
 * Configuración Prettier compartida.
 * Uso: en la raíz, `prettier.config.mjs` reexporta este módulo.
 *
 * @type {import('prettier').Config}
 */
const config = {
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'all',
  bracketSpacing: true,
  arrowParens: 'always',
  endOfLine: 'lf',
  overrides: [
    {
      files: ['*.md'],
      options: { proseWrap: 'preserve' },
    },
    {
      files: ['*.{yml,yaml}'],
      options: { singleQuote: false },
    },
  ],
};

export default config;
