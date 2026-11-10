#!/bin/sh
# Exports environment variables from Docker-mounted secret files, then execs the command.
#   SECRET_ENV="DATABASE_URL=AZEE_DATABASE_URL;AZTRADE_SERVICE_SECRET=AZTRADE_SERVICE_SECRET"   (VAR=secret-file-name; ...)
# A missing secret stops the container (fail closed). Values are never printed.
set -eu
OLDIFS="$IFS"; IFS=';'
for pair in ${SECRET_ENV:-}; do
  var="${pair%%=*}"; file="${pair#*=}"
  [ -r "/run/secrets/$file" ] || { echo "FATAL: required secret '$file' is not mounted" >&2; exit 1; }
  export "$var=$(cat "/run/secrets/$file")"
done
IFS="$OLDIFS"
exec "$@"
