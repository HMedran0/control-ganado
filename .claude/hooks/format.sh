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
