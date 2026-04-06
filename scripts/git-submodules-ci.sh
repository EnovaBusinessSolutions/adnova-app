#!/usr/bin/env bash
# Clona submódulos en CI (p. ej. Render). Repos privados en GitHub requieren token.
#
# En Render: Environment → add variable:
#   GITHUB_TOKEN = fine-grained PAT (Contents: Read) o classic PAT con scope repo,
#   con acceso al repo del submódulo (p. ej. NSPG13/Landing-adray).
#
# Sin token: haz público el repo del submódulo o duplícalo bajo EnovaBusinessSolutions.
set -euo pipefail

if [ -n "${GITHUB_TOKEN:-}" ]; then
  git config --global url."https://x-access-token:${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/"
fi

git submodule update --init --recursive
