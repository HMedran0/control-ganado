#!/usr/bin/env bash
# Formatea y revisa con lint el archivo editado. Silencioso si el proyecto aún no está instalado.
# Sin jq no sabe qué archivo formatear: avisa y deja seguir (formatear no protege nada).
if ! command -v jq >/dev/null 2>&1; then
  echo "Aviso: jq no está instalado; no se formateó ni se revisó con lint el archivo editado (winget install jqlang.jq)." >&2
  exit 0
fi
INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE" ] && exit 0
[ -z "$CLAUDE_PROJECT_DIR" ] && exit 0

# Ruta comparable en Windows y en Linux: barras normales, «/c/...» de Git Bash como «c:/...» y,
# si tiene letra de unidad, en minúsculas (en Windows «C:\Users» y «c:\users» son lo mismo).
normalize() {
  local path="${1//\\//}"
  if [[ "$path" =~ ^/([a-zA-Z])/(.*)$ ]]; then path="${BASH_REMATCH[1]}:/${BASH_REMATCH[2]}"; fi
  if [[ "$path" =~ ^[a-zA-Z]:/ ]]; then path="${path,,}"; fi
  printf '%s' "${path%/}"
}

# Fuera del repositorio (por ejemplo, el scratchpad) no hay configuración de Prettier ni de
# ESLint que aplicar: no se hace nada.
ROOT=$(normalize "$CLAUDE_PROJECT_DIR")
case "$(normalize "$FILE")" in
  "$ROOT"/*) ;;
  *) exit 0 ;;
esac

cd "$CLAUDE_PROJECT_DIR" || exit 0
[ -d node_modules ] || exit 0

case "$FILE" in
  *.ts|*.tsx|*.js|*.mjs|*.cjs|*.json|*.md|*.css|*.yml|*.yaml)
    pnpm exec prettier --write --log-level warn "$FILE" >/dev/null 2>&1 || true ;;
esac

case "$FILE" in
  *.ts|*.tsx|*.js|*.mjs|*.cjs)
    OUT=$(pnpm exec eslint --no-warn-ignored "$FILE" 2>&1)
    if [ $? -ne 0 ]; then
      echo "ESLint encontró problemas en $FILE. Corrígelos antes de continuar:" >&2
      echo "$OUT" | tail -40 >&2
      exit 2
    fi ;;
esac
exit 0
