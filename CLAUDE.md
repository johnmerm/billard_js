# Working on this repo

## Shipping a version

The scripts in `index.html` carry a `?v=` tag so a browser cannot pair a fresh
page with a stale script. Bump every one of them together whenever any of them
changes.

`index.html` itself has no tag — it is the entry point — so a browser or a cdn
can hand back an old copy of the page that then asks for the old scripts. A
query string on the page url is what gets past that.

**So: after pushing a change, always hand back the full link with the
cache-buster bumped**, not just the number:

    https://raw.githack.com/johnmerm/billard_js/<branch>/index.html?x=<n>

`raw.githack.com` rather than `rawcdn.githack.com`: the cdn host caches a
branch url hard and would pin an old build.

## Tests

`node test/<name>.test.js`, one file per area, or all of them at once with
`npm test`. They are plain node with no framework. The browser ones are driven
with playwright from a scratch directory rather than committed.
