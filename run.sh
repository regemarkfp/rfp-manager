#!/bin/sh
cd "$(dirname "$0")" && exec node --disable-warning=ExperimentalWarning server.js
