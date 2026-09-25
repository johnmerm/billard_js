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

A url pinned to a commit sha cannot go stale at all, since a different commit
is a different path, so prefer one whenever it matters which build is running:

    https://raw.githack.com/johnmerm/billard_js/<sha>/index.html

When a fix looks like it did not work, check the build before checking the fix.
The transcript window prints it, and `LLM.build` reports it in the console; both
read it off this script's own `?v=` tag, so they cannot drift from the page. A
stale page asking for stale scripts looks exactly like a fix that does nothing.

## Tests

`node test/<name>.test.js`, one file per area, or all of them at once with
`npm test`. They are plain node with no framework. The browser ones are driven
with playwright from a scratch directory rather than committed.
