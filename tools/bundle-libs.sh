#!/bin/sh
# Rebuild the vendored library bundles. Run from this directory after
# `npm install three cannon-es esbuild`, then copy the output into lib/.
set -e

FOOTER_THREE='if (typeof globalThis === "object") globalThis.THREE = THREE; if (typeof module === "object" && module.exports) module.exports = THREE;'
FOOTER_CANNON='if (typeof globalThis === "object") globalThis.CANNON = CANNON; if (typeof module === "object" && module.exports) module.exports = CANNON;'

npx esbuild node_modules/three/build/three.module.js \
    --bundle --format=iife --global-name=THREE --minify --legal-comments=inline \
    --footer:js="$FOOTER_THREE" --outfile=three.js

npx esbuild node_modules/cannon-es/dist/cannon-es.js \
    --bundle --format=iife --global-name=CANNON --minify --legal-comments=inline \
    --footer:js="$FOOTER_CANNON" --outfile=cannon-es.js
