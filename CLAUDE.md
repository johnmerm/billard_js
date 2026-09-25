# Working on this repo

## Shipping a version

The scripts in `index.html` carry a `?v=` tag so a browser cannot pair a fresh
page with a stale script. Bump every one of them together whenever any of them
changes.

`index.html` itself has no tag — it is the entry point — so a browser or a cdn
can hand back an old copy of the page that then asks for the old scripts. A
query string on the page url is what gets past that.

**So: after pushing a change, always hand back a link pinned to the commit**,
not a branch link:

    https://raw.githack.com/johnmerm/billard_js/<sha>/index.html?x=<n>

A different commit is a different path, so a pinned url cannot go stale at all
— which a branch url can, and did, costing two rounds of chasing a fix that was
already in the file. `raw.githack.com` rather than `rawcdn.githack.com`: the cdn
host caches harder still.

## Saying which build is running

The page prints it in the bottom left, as `build <v> · <ref>`, and
`Billiards.build` reports it in the console. The `<v>` is this script's own
`?v=` tag and the `<ref>` comes off the url — a commit id when the page is
pinned, and the branch name in amber when it is not. Neither can drift from
what is actually loaded, because neither is written down anywhere.

The page cannot carry its own commit id: writing a hash into a file changes the
file, which changes the hash. So **tag each shipped build** — `git tag v<n>` on
the commit that bumps `?v=` to `<n>`, and push it — and `build 41` in the corner
resolves with `git rev-parse v41`.

When a fix looks like it did not work, check the build before checking the fix.
A stale page asking for stale scripts looks exactly like a fix that does
nothing.

## Tests

`node test/<name>.test.js`, one file per area, or all of them at once with
`npm test`. They are plain node with no framework. The browser ones are driven
with playwright from a scratch directory rather than committed.
