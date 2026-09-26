#!/usr/bin/env bash
# Bloquea escrituras en archivos protegidos. Exit 2 = bloquear y explicar a Claude.
INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE" ] && exit 0
REL="${FILE#"$CLAUDE_PROJECT_DIR"/}"

case "$REL" in
  .env|.env.*|*/.env|*/.env.*)
    [ "$(basename "$REL")" = ".env.example" ] && exit 0
    echo "Bloqueado: no se editan archivos .env con secretos. Usa .env.example para documentar variables." >&2
    exit 2 ;;
  docs/referencia/*)
    echo "Bloqueado: docs/referencia/ es la especificación de partida. Si el hito requiere cambiarla, pide autorización al usuario." >&2
    exit 2 ;;
  apps/api/prisma/migrations/*/migration.sql)
    if [ -f "$FILE" ]; then
      echo "Bloqueado: no se modifica una migración existente. Crea una nueva migración." >&2
      exit 2
    fi ;;
esac
exit 0
