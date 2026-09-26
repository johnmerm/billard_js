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

# tensorflow.js ships a browser bundle already, so there is nothing to build -
# it only has to be copied. It is only fetched when somebody switches the AI
# opponent on, which is why it is not in index.html with the others.
cp node_modules/@tensorflow/tfjs/dist/tf.min.js tfjs.js

# and so does marked, which docs.html uses to render the markdown files in
# this repo. Vendored rather than fetched from a cdn for the same reason as
# the rest: a page pinned to a commit should be the whole of what it needs,
# and a cdn is one more thing that can be unreachable or different tomorrow.
cp node_modules/marked/marked.min.js marked.js
