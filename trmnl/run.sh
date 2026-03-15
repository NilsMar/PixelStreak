#!/usr/bin/env bash
set -euo pipefail

# Load variables from the project root .env
ENV_FILE="$(dirname "$0")/../.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: .env not found at $ENV_FILE"
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

node "$(dirname "$0")/send.js"
