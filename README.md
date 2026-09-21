# billard_js

An eight ball game in the browser: a table seen from directly above, and a
second camera that rides inside the cue ball.

Open `index.html` — no build step, no package manager, no network.

https://cdn.rawgit.com/johnmerm/billard_js/master/demo.html is the original
Box2D prototype, which is still in the repo as `demo.html`.

## The two views

The table view is an orthographic camera straight overhead: that is the view you
aim in, and the one that shows the whole layout. The cue ball view is a
perspective camera sitting at the centre of the white ball, pointing wherever you
are aiming, and along the direction of travel once the ball is moving. Either one
can be the big picture — press **V** (or the button) to swap the inset and the
main view.

## Playing

| | |
|---|---|
| move the mouse | aim |
| hold the mouse or **space** | build power, release to shoot |
| **←** **→** | fine aim (hold **shift** for finer) |
| **↑** **↓**, **A**/**D**, **C** | follow/draw, left/right english, centre ball |
| drag the spin dial | the same thing with the mouse |
| **V** / **R** / **M** | swap views / new rack / mute |

Standard eight ball: break from behind the head string, the table stays open
until the first ball is potted after the break, then you are on solids or
stripes, and the 8 goes last. Scratching, hitting the wrong ball first, hitting
nothing, or failing to reach a cushion is a foul and hands your opponent ball in
hand. The 8 on the break is spotted rather than losing the game.

## What is where

| file | what it does |
|---|---|
| `phys.js` | the physics: rolling, sliding, spin, cushions, pockets. No dependencies, runs in node too |
| `render.js` | the three.js scene and the two cameras |
| `game.js` | rules, input, HUD |
| `ball_skins.js` | paints the sixteen balls onto canvases |
| `index.html` | the page |
| `test/phys.test.js` | physics regression tests: `node test/phys.test.js` |

`lib/three.js` is r68, vendored. `lib/Box2dWeb-2.1.a.3.js`, `two_d.js`,
`three_d.js`, `draw.js` and `ball_textures.js` belong to the old `demo.html`
prototype and are untouched.

## About the physics

`phys.js` is written for this game rather than pulled in as a general rigid body
engine, because a pool table only ever needs one shape and gets most of its
character from the contact patch between ball and cloth.

Each ball carries a linear velocity and an angular velocity. The velocity of the
point where it touches the cloth decides everything: while that point is
slipping, kinetic friction slows the ball and spins it up until it rolls, which
is why a ball struck below centre comes back, one struck above centre follows
through, and a stun shot stops dead. Once it is rolling, only the much smaller
rolling resistance is left, so balls travel a long way at walking pace. Spin
about the vertical axis bleeds off separately and gets thrown into the tangent
when the ball meets a cushion.

Ball on ball contact is an impulse along the line of centres with a restitution
just under one. Cushions are line segments — the same segments the renderer
builds the rubber from — that stop short of each pocket and are cut back at 45
degrees, so the jaws are real geometry and a ball can rattle in them. Substeps
are sized so nothing moves more than a quarter of a ball radius at a time, which
is what keeps a hard break from tunnelling through the rack.

Units are SI throughout: a 2.24 x 1.12 m playing surface, 57.15 mm balls, 170 g
each.
