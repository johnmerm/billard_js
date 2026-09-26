# Working on this repo

## Shipping a version

The scripts in `index.html` carry a `?v=` tag so a browser cannot pair a fresh
page with a stale script. Bump every one of them together whenever any of them
changes. `docs.html` is in the same scheme — it tags its renderer and the
markdown it fetches — so bump those two with the rest.

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
file, which changes the hash. The commit-pinned url is the identity instead —
it names the commit exactly, and the corner echoes it back.

Tagging each build (`git tag v<n>` on the commit that bumps `?v=` to `<n>`)
makes the number in the corner resolvable with `git rev-parse v41`, which is
worth having. Note that a session working on this repo may not be able to push
one: the credential is scoped to `claude/*` branch refs, and a tag push comes
back 403 even when the branch push just succeeded. So that step belongs to
whoever has full push rights.

When a fix looks like it did not work, check the build before checking the fix.
A stale page asking for stale scripts looks exactly like a fix that does
nothing.

## Tests

`node test/<name>.test.js`, one file per area, or all of them at once with
`npm test`. They are plain node with no framework. The browser ones are driven
with playwright from a scratch directory rather than committed.
