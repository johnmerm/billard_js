# billard_js

An eight ball game in the browser: a table seen from directly above, and a
second camera that rides inside the cue ball.

## Playing it

Open `index.html` — no build step, no package manager, no network. Cloning the
repo and double clicking the file is enough; every script it loads sits next to
it.

Served from GitHub Pages (Settings → Pages → deploy from the default branch) it
lives at **https://johnmerm.github.io/billard_js/**, and the original Box2D
prototype, still in the repo as `demo.html`, at
https://johnmerm.github.io/billard_js/demo.html. The old `cdn.rawgit.com` link
that used to be here stopped working when rawgit shut down in 2019.

## The two views

The table view is an orthographic camera straight overhead: that is the view you
aim in, and the one that shows the whole layout. The cue ball view is a
perspective camera sitting at the centre of the white ball, pointing wherever you
are aiming, and along the direction of travel once the ball is moving. Either one
can be the big picture — press **V** (or the button) to swap the inset and the
main view.

## Controls

Every control is a button on screen, so the game plays the same with a thumb as
with a keyboard.

| | |
|---|---|
| drag on the table | aim |
| hold **SHOOT** | build power, let go to take the shot |
| **◀ ▶** | nudge the aim — a tap is a hair, holding sweeps |
| the spin dial | drag the tip around the cue ball; double click to centre it |
| the small view | tap it to bring it up front |
| the top right buttons | swap views, sound, new rack |

On a mouse the old habits still work: hold the button down on the table to
charge and release to shoot, **space** to charge, **←** **→** to fine aim
(**shift** for finer), **↑** **↓** and **A**/**D** for follow, draw and english,
**C** to centre, **V** / **R** / **M** for views, a new rack and sound.

On a touch screen dragging only ever aims — the shot needs the SHOOT button —
so you can slide a finger around the table without firing the cue ball across
the room. The controls take the bottom of the screen and the table is fitted to
what is left, rather than being hidden behind them, and a phone held upright
stands the table on end to fill the screen.

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
