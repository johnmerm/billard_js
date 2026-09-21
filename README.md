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
| `phys.js` | the table: builds it out of cannon.js bodies, strikes the cue ball, reports what happened |
| `render.js` | the three.js scene and the two cameras |
| `game.js` | rules, input, HUD |
| `ball_skins.js` | paints the sixteen balls onto canvases |
| `index.html` | the page |
| `test/phys.test.js` | physics regression tests: `node test/phys.test.js` |

`lib/cannon.js` is cannon.js 0.6.2 and `lib/three.js` is three.js r68, both
vendored, both MIT. `lib/Box2dWeb-2.1.a.3.js`, `two_d.js`, `three_d.js`,
`draw.js` and `ball_textures.js` belong to the old `demo.html` prototype and
are untouched.

## About the physics

cannon.js runs the simulation. The balls are rigid spheres with friction against
the cloth, and the cue strike is an impulse applied off centre, so draw, follow,
stun and english are not special cases anywhere in this repo — they fall out of
where the tip meets the ball. Hit it below centre and it comes back; hit it above
and it follows through.

`phys.js` is the table around that:

- **The bed is exactly the playing surface.** There are no pocket trigger zones.
  Rails seal the cloth everywhere except the six mouths, so a ball that crosses
  one runs out of cloth and falls, and you watch it drop. It counts as potted
  when it passes below the bed.
- **Cushions are boxes** built from a list of segments that stop short of each
  pocket and are cut back at 45 degrees. The renderer builds the visible rubber
  from the same list, so what you see is what you hit, jaws included.
- **Rolling resistance is added by hand**, in a `preStep` hook. It is the one
  thing a general purpose engine has no reason to model: contact friction alone
  will not stop a rolling ball, so the cloth applies a small constant drag and
  holds anything that has all but stopped.
- **Sleeping is off.** cannon leaves sleeping bodies out of the solver, so a ball
  that had dozed off swallowed part of the impulse when it was hit. The rest
  clamp above does that job instead.
- **Contacts between balls are stiff and barely relaxed.** The defaults are
  tuned for boxes settling into stacks and soak up an impact between two balls.
  Ball on ball friction is kept low for the same reason: at this scale cannon's
  friction impulse is generous, and anything higher spins the object ball up at
  the expense of the speed it should leave with.
- **Fixed 1/480 s steps**, with cannon sub-stepping to catch up. A hard break
  moves a ball about 8 m/s, or 17 mm a step, comfortably less than a ball
  radius, so nothing tunnels through the rack.

Two coordinate systems meet in `phys.js`. The game thinks in table coordinates —
x along the length, y across the width, both from a corner — while cannon and
three.js share a y-up world centred on the table. Positions and directions are
converted; orientations never are, because the renderer copies ball quaternions
straight off the bodies.

Units are SI: a 2.24 x 1.12 m playing surface, 57.15 mm balls, 170 g each.
