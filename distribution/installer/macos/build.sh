#!/bin/sh
set -eu
[ "$(uname -s)" = Darwin ] || { echo 'Execute em um Mac.' >&2; exit 1; }
cd "$(dirname "$0")/../.."
npm install
npm run lint
npm test
npm run package:mac
