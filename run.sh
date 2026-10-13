#!/bin/sh
# exit code 75: RFP Manager updated itself, start it again
cd "$(dirname "$0")" || exit 1
while :; do
  node --disable-warning=ExperimentalWarning server.js
  code=$?
  [ "$code" = 75 ] || exit "$code"
done
