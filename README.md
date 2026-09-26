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
are aiming, and along the direction of travel once the ball is moving — a jump
shot takes it up with the ball.

They are panes, not a picture in a picture: each owns its own strip of the
screen and neither covers any part of the other, nor sits under the panels —
the score and buttons take a band along the top, the controls take one along the
bottom, and the views divide up everything in between. They divide the space along its
longer side, so a landscape window puts them side by side and a tall one stacks
them, and they only tile what the panels have left rather than running underneath
the controls. Drag the seam between them to give one more room than the other —
where you leave it is remembered. **V**, the button, or a tap on the cue ball
pane swaps which view is which.

## Controls

Every control is a button on screen, so the game plays the same with a thumb as
with a keyboard.

| | |
|---|---|
| drag on the table | aim |
| hold **SHOOT** | build power, let go to take the shot |
| **◀ ▶** | nudge the aim — a tap is a hair, holding sweeps |
| the spin dial | drag the tip around the cue ball; double click to centre it |
| the **cue** slider, or **[** **]** | raise the cue for a jump shot — it drops back to level after every shot |
| the cue ball pane | tap it to swap the two views |
| the seam between the views | drag it to give one of them more room |
| the top right buttons | swap views, sound, hint, dock panels, new rack |
| the **AI** chip on a player's line | hand that seat to the network, or take it back |
| **Hint**, or **H** | ask the network what it would play, without it playing it |
| the **⋮⋮** grip on a panel | drag it anywhere; double tap to put it back |
| ball in hand | point at the spot and click or tap — the ball waits off the table until you put it down, so looking for a spot cannot nudge the balls already on it |

On a mouse the old habits still work: hold the button down on the table to
charge and release to shoot, **space** to charge, **←** **→** to fine aim
(**shift** for finer), **↑** **↓** and **A**/**D** for follow, draw and english,
**C** to centre, **V** / **R** / **M** for views, a new rack and sound.

The panels sit in their own bands rather than on top of the table, so nothing
covers a shot. Drag one out by its grip and it floats free — and since it is no
longer taking up a band, the views grow into the space it left. A double tap on
a grip puts that panel back, **Dock panels** or **L** puts them all back, and
where you left them is remembered between sessions — so a panel left floating in
an earlier session is still floating when you come back, and the button is how
you get the bands again.

On a touch screen dragging only ever aims — the shot needs the SHOOT button —
so you can slide a finger around the table without firing the cue ball across
the room. The controls take the bottom of the screen and the table is fitted to
what is left, rather than being hidden behind them, and a phone held upright
stands the table on end to fill the screen.

As the window narrows the two bands give things up in the order they can afford
to lose them, so that what is left stays on one row: the keyboard hints go
first, since they only repeat what the buttons beside them do; then the button
labels, which have tooltips; then the power bar, since the SHOOT button fills up
as it charges; then the group captions; and last the controls come down a size,
stopping at about 44px, which is as small as anything a thumb has to hit should
get. Everything on one row down to 360px on a touch screen and 400px with a
pointer. Below that the bands wrap rather than pushing their ends off the
screen — unwrapped and centred, they used to leave the aim buttons at a negative
x where nothing could reach them.

Standard eight ball: break from behind the head string, the table stays open
until the first ball is potted after the break, then you are on solids or
stripes, and the 8 goes last. Scratching, hitting the wrong ball first, hitting
nothing, or failing to reach a cushion is a foul and hands your opponent ball in
hand. The 8 on the break is spotted rather than losing the game.

## Jump shots

Raise the cue and the tip drives the ball down into the slate instead of along
the cloth. The slate is rigid and hands most of that straight back, which is the
jump: the ball leaves at roughly half the angle the cue was raised to, so 45
degrees of cue gets about 24 degrees of launch. At 55 degrees and a firm stroke
the cue ball clears 14 cm — a ball is 5.7 cm tall — and lands in time to hit
something 50 cm away.

The table view looks straight down, where height does not show at all, so a
jumping ball would appear to slide through whatever it is jumping over. Its
shadow is what gives it away: it slides out from under the ball and fades as the
ball climbs. The view from the cue ball rides the real height, so a jump takes
you up with it.

## Without WebGL

Some browsers will not start WebGL: hardware acceleration is switched off, the
driver is blocklisted, or the browser has stopped quietly falling back to
software WebGL the way Chrome used to. Rather than a blank window, the game
drops to `render2d.js`, which draws **both** views on an ordinary 2d canvas.

The table view becomes a flat plan — coloured discs on green cloth, with the
cue, the aiming guides, the ghost ball, the shadows that give a jumping ball
away and the ball in hand marker all still there. The cue ball view is a pinhole
camera written out by hand: points go into the camera's frame, get divided by
their depth, and polygons are clipped against the near plane before they are
filled, because a quad with a corner behind the camera turns inside out
otherwise. The cloth, the rails and the balls are painted back to front, which
is all the depth sorting a table needs — a ball never gets behind a cushion.

So the panes, the seam, the captions and **V** all work exactly as they do with
three.js. The physics, the rules and every control are untouched; only the
picture is simpler, and the page says so once in a banner that closes itself.

Nothing has to be configured for this. If WebGL comes back, so does the 3d
table. To get it back in Chrome, turn on *use graphics acceleration when
available* in the settings and restart, or look at `chrome://gpu` to see what is
holding it back.

## What is where

| file | what it does |
|---|---|
| `phys.js` | the table: builds it out of cannon-es bodies, strikes the cue ball, reports what happened |
| `render.js` | the three.js scene and the two cameras |
| `render2d.js` | both views on a plain 2d canvas, for browsers that will not start WebGL |
| `rules.js` | eight ball, and nothing else: it judges a shot, it does not act on one |
| `brief.js` | the position written out, for a player that reads instead of looks |
| `llm.js` | a seat played by a language model, over its provider's api |
| `game.js` | input, the phase machine, sound and the HUD |
| `ball_skins.js` | paints the sixteen balls onto canvases |
| `panels.js` | makes the heads up panels draggable, and remembers where they went |
| `index.html` | the page |
| `test/phys.test.js` | physics regression tests: `node test/phys.test.js` |
| `test/rules.test.js` | eight ball rules tests: `node test/rules.test.js` |
| `test/render2d.test.js` | flat renderer tests: `node test/render2d.test.js` |
| `test/brief.test.js` | written table tests: `node test/brief.test.js` |
| `train/geometry.js` | ghost ball aiming and the shortlist of pots worth playing |
| `tools/drive.js` | the game from a terminal: `node tools/drive.js open`, then `brief`, `play` |
| `train/match.js` | a rack played with no browser: rack, shoot, settle, judge |
| `train/bot.js` | the baseline player a learned one has to beat |
| `train/selfplay.js` | play the bots against each other: `node train/selfplay.js --games 20` |
| `train/encode.js` | a table as 109 numbers, from the point of view of whoever is about to shoot |
| `train/collect.js` | self play across every core, written down: `node train/collect.js --games 400` |
| `train/value.js` | learns to judge a position from that: `node train/value.js --data data/v1` |
| `train/player.js` | plays by simulating each shot and judging what it leaves behind |
| `train/dump.js` | positions and features as json, for anything outside node |
| `NETWORK.md` | the network in full: what it sees, how it was trained, what it scores |
| `notebooks/value-network.ipynb` | the shipped weights opened up and made to work |
| `ai.js` | the trained player on the page: fetches the model, thinks without freezing it |
| `test/geometry.test.js` | shot geometry tests: `node test/geometry.test.js` |
| `test/match.test.js` | harness and bot tests: `node test/match.test.js` |
| `test/encode.test.js` | encoder and collector tests: `node test/encode.test.js` |
| `test/value.test.js` | value network tests: `node test/value.test.js` |
| `test/player.test.js` | value player tests: `node test/player.test.js` |
| `tools/bundle-libs.sh` | rebuilds the two vendored libraries |

`lib/three.js` is three.js r186 and `lib/cannon-es.js` is cannon-es 0.20, both
MIT. Both ship as ES modules only these days, and a browser will not load a
module over `file://`, which would have meant running a local server just to
open the game. So they are vendored as plain scripts that define `THREE` and
`CANNON`, bundled with esbuild by `tools/bundle-libs.sh`. Nothing here needs a
build step to run — the script is only for pulling in a newer version of either
library.

`lib/Box2dWeb-2.1.a.3.js`, `two_d.js`, `three_d.js`, `draw.js` and
`ball_textures.js` belong to the old `demo.html` prototype and are untouched.

## Saving a game

`G` writes the game out as a file, and dropping one back on the table replays
it. `Billiards.saveGame()` and `Billiards.replay(log)` do the same from the
console.

The file holds the rack order, the house rules in force, and every placement
and shot — and, for each shot, where the balls actually finished. That last
part is there because live play is driven by the clock: a busy frame throws
simulated time away, so the same shot takes a different number of steps and
finishes somewhere slightly else. Re-simulating a recording does not land on
it.

Stepping a fixed quantum per frame does fix that, and was tried and reverted —
it makes simulated time run at whatever rate the frames do, so a machine that
cannot hold 60Hz plays in slow motion. A game should not make that trade for a
feature it uses occasionally.

So a replay rolls the balls for the look of the thing and then puts them
exactly where the recording says they ended up. What you watch is what
happened rather than something very like it, and the positions are the whole
diagnosis on their own for a game sent to somebody who never runs it.

## House rules

Eight ball has one codified set of rules and a great many pub variants. The
variants live in `Rules.options`, off by default, so the game is the standard
one until it is asked not to be:

| rule | what it does |
|---|---|
| `blackcushion` | a cushion has to come into the shot that wins the game |

One rule, satisfied two ways: the cue ball off a cushion before it touches the
8 (a *kick*), or the 8 off a cushion before it drops (a *bank*). Either will
do. The point of the rule is that a game may not end on a ball rolled straight
from the cue into a pocket, not that it has to end on one particular shot.

It judges the shot that finishes the game and nothing else. A safety played
off the 8 is still a safety — only the ball that actually drops has to have
come by way of a cushion — and the rule says nothing at all about any other
ball on the table.

Doing both in the same shot is not asked for. It is a flourish, and the game
notices: `Rules.resolve` returns `flourish: true` when the winning shot kicked
*and* banked, and the page says so in letters far too big for the occasion,
with a noise to match. That one is not conditional on the rule being on — it
is a feat under the standard game too.

Turn it on with `?house=blackcushion`, which is where it belongs: a house rule
has to be agreed before anybody breaks, and a link is how you agree it. The
corner marker names the rules in force, and
`Billiards.houseRule('blackcushion', true)` flips it mid-game for trying it
out. The rule was two separate ones for a while — `blackbank` and `blackkick`,
each demanding its own cushion — so links and saved games naming either of
those still land on this one.

It is not in the WPA or blackball rulebooks — it is a house rule, widespread
enough to have names for both halves of it. The codified requirement those *do*
put on the 8 is calling the pocket, which this does not implement.

## One rulebook

`rules.js` holds the eight ball rules and nothing else, and `Rules.resolve` is a
function rather than a procedure: give it the table and a finished shot and it
returns what happened — the foul if there was one, who shoots next, whether the
halves have just been decided, whether the game is over — without changing
anything. `game.js` applies that to its own state, plays the sounds and writes
on the screen; anything headless applies it to its own and racks up again.

That split is what lets a match be played with no browser at all, which is what
a self play trainer needs. It also means the rules can be tested directly, one
call per case, rather than by driving a page.

## Seats

Each seat is played by one of four things, named in `state.seats`:

| kind | who |
|---|---|
| `human` | somebody at the keyboard |
| `net` | the value network in `train/player.js` |
| `llm` | a language model, over its provider's api (`llm.js`) |
| `driver` | something operating the page from outside |

The chip on each player's panel opens a menu of the three you can choose, so
every matchup - human against a model, the network against a model, two models,
the network against itself - is two clicks and needs no code. It cycled through
them at first, which made you click past the one you did not want and past a
model download on the way to it. Two bitmasks used to do this between them and
could not express a seat played by a third thing.

Anything that is not a person has its shots slowed to 0.65x, for the same
reason in every case: a shot nobody at the table chose goes by too fast to
follow.

### A language model in a seat

Clicking a seat to `LLM` asks for an api key and a model, and opens a second
window that shows the brief each player was sent and the sentence it gave back.
The key is typed in at runtime, goes nowhere but the provider, and is never
committed. It does live in the page while you play, so what matters is who can
change the page: see **Where the page itself comes from** below.

The model is given `brief.js`'s numbered menu rather than a table of
coordinates, and answers with a pot number plus how hard to hit it. Prices are
yours to type in, so the running total is right for whatever model you picked
rather than for one a hard-coded table happened to know about, and there is a
spend cap per page load, because a game that plays itself is a loop that bills.

The key can be left unstored (the default), sealed under a passphrase, or kept
in the open. The middle one is AES-GCM under PBKDF2 through WebCrypto: a
storage dump, a backup or somebody else on the machine gets ciphertext. It is
no defence against a script running on this origin while you play, and the
dialog says so.

It matters most on a host like githack, and for a reason that catches people
out: an origin is a scheme, a host and a port, and **the path is not in it**.
Every `raw.githack.com` url is the same origin as every other one, so a page in
a stranger's repo, served through githack, shares this page's `localStorage`
and can read anything left there by name — and the name is in this repo, which
is public. So on those hosts the dialog does not offer to store a key in the
open at all, and the passphrase stops being a nicety.

The same fact has a second edge: same origin means such a page can also put
this one in an iframe and reach straight into it. The dialog refuses to take a
key when it finds itself framed, and says why.

WebCrypto needs a secure context, which https and localhost are and a `file://`
page is not — so the passphrase option switches itself off when you open the
page from disk, and works fine over githack.

### Where the page itself comes from

A key typed into a page is only as safe as whoever can change that page. Served
off a branch, the page is whatever was last pushed there, and it arrives with
your key already in it. The same url pinned to a commit cannot change under
you:

    https://raw.githack.com/<user>/<repo>/<commit-sha>/index.html

The dialog works out which it is from the url and says so, rather than leaving
a warning that is either alarming or complacent. Pinning costs nothing but a
longer link, and pairs with the obvious other half: give this a key of its own
with its own spend limit, so a leak is a capped bill and a revocation.

### Which providers work from a browser

A provider has to send CORS headers or a page cannot call it at all, and the
refusal reaches javascript as a bare `TypeError` with nothing in it. So the
dialog asks, the moment you pick a provider and before you have typed anything.

It needs no key. It asks the model list, with the key if there is one and a
placeholder that says what it is if there is not: a provider that allows
browsers answers, which `fetch` resolves, and one that does not is refused
before anything leaves the browser, which `fetch` rejects. The one ambiguity is
that being offline rejects too, so the first provider that answers at all is
remembered — after that, a rejection can only mean refused.

It asks the *list* rather than the endpoint the game plays through, for a
reason worth recording: aimed at the completions endpoint it looked, in
devtools, exactly like a failed shot carrying a bogus key, and the obvious
reading of that is that the page has lost yours.

    Claude takes calls from a browser (it answered 401 to a deliberately bad key).
    Grok refuses calls from a browser. Nothing on this page can change that —
    it would need a proxy to add the headers, and the key could live there instead.

All five answered when this was first run against real endpoints — 401, or a
400 from the one that objected to the empty body before it objected to the key
— so all five take browser calls. That was not knowable from the machine this
was built on, whose network allows `api.anthropic.com` and nothing else, which
is exactly why the page asks for itself rather than shipping a table of claims.

### The model list

The same applies to model ids, and worse: a list shipped in the page is a list
that goes stale, and a guessed default is worse than an empty box. So once
there is a key in the dialog, the provider is asked what it can run — all five
serve it at `/v1/models` in the same shape — and the box fills itself.

It stays free text. A list is a help, not a gate, and a model the list has not
caught up with should still be typeable. A provider whose key cannot read the
list says so and the box goes on working.

## Driving it from outside

The page carries a small surface for something operating the game without a
mouse: an agent in a terminal, or you at the console. It speaks centimetres,
the way the brief does, and answers in sentences rather than in objects,
because what reads it next is as likely to be a language model as a program.

| call | does |
|---|---|
| `Billiards.brief(seat)` | the position in words, or who it is waiting on |
| `Billiards.awaitTurn(seat)` | a promise for the brief, once it is your go |
| `Billiards.play(n, power, side, vert, seat)` | take pot `n` from the brief's list |
| `Billiards.aim(x, y, power, side, vert, seat)` | shoot at a point instead: safeties, escapes |
| `Billiards.placeCue(x, y, seat)` | put the cue ball down while it is in hand |

`power` runs 0 to 1, so a driver never has to know the table's units. `seat` is
1 or 2 and optional, and worth passing when two drivers share a table: it is
what stops one of them moving on the other's turn.

`play` and `aim` return a promise that resolves when the balls stop, carrying
what the rulebook made of the shot and where the cue ball finished — the thing
the shot was really steering. Both go through the same path the network's shots
take, so a driven shot lines up and draws back on the screen at the same pace,
which is the whole point of watching one.

### From a terminal

`tools/drive.js` turns each of those into one command, against a Chrome that is
already running, so the window stays on screen between commands and a person
can watch the match happen. It talks the debugger protocol directly rather than
through a browser automation library: a debugging socket is a few lines of node
with nothing installed, and the repo stays as dependency free as the game.

Nothing needs it, though. Those few lines inline are a whole turn, so an agent
with a shell can reach the page without this or anything else installed:

    node -e '
    const res = await fetch("http://127.0.0.1:9222/json/list");
    const t = await res.json();
    const w = new WebSocket(t.find(x => x.url.includes("index.html")).webSocketDebuggerUrl);
    w.onopen = () => w.send(JSON.stringify({id: 1, method: "Runtime.evaluate",
        params: {expression: process.argv[1], awaitPromise: true, returnByValue: true}}));
    w.onmessage = e => { console.log(JSON.parse(e.data).result.result.value); process.exit(0); };
    ' 'Billiards.brief(1)'

Going straight at the page is the better way round for an agent, which can
compose - filter the brief, read `Billiards.state` - where a fixed set of
subcommands cannot. What the tool is genuinely worth keeping for is `open`,
which knows the two things a first run finds the hard way, and the exit code,
which lets a shell loop stop by itself.

    node tools/drive.js open          # chrome, with the game on it
    node tools/drive.js wait 1        # blocks until it is your turn
    node tools/drive.js play 2 0.6    # the second pot, medium pace

`brief`, `wait`, `play`, `aim`, `place`, `rack` and `state` take the arguments
their page equivalents take. The exit code is 2 once the game is over, so a
shell loop ends by itself:

    while BRIEF=$(node tools/drive.js wait 1); do
        node tools/drive.js play 1 0.55 0 0 1 || break
    done

`open --headless` runs the whole thing on a machine with no screen, which gives
up the one thing the arrangement is for but is useful on a server.

### What the pot list is and is not

It is aiming geometry, and that is all. Taken literally - always pot `[1]` - what
it is worth depends entirely on the power under it, measured over ~500 shots per
row:

| habit | pots | scratches | misses |
|---|---|---|---|
| power 0.80, no spin | 63% | 16% | 21% |
| power 0.55, no spin | 66% | 12% | 22% |
| power 0.55, draw -0.5 | 64% | 18% | 18% |
| power 0.30, no spin | 71% | 12% | 17% |
| power 0.30, draw -0.5 | 75% | 7% | 18% |

Almost none of the losses are bad aim: the cue ball follows the object ball in,
because nothing in the shortlist knows where it ends up. Note the reversal in
the middle - draw makes scratching worse at 0.55 and nearly halves it at 0.30 -
which is the sort of thing that is obvious only once measured. Judging the
position a shot leaves is what `train/player.js` and the value network are for.

## Playing it without a browser

`train/` holds a table that plays itself. `node train/selfplay.js --games 20`
racks up, plays both bots against each other and says what happened; a rack
takes about one and a half seconds, against a couple of minutes on the page,
because nothing is waiting for frames.

The baseline bot plays the way you might after an afternoon in a pub: take the
straightest pot on the table, hit it hard enough to reach the pocket, and if
there is nothing on, roll up behind something and hope. It never asks where the
cue ball will finish, which is exactly the gap a learned player is meant to
fill. `--a search4` turns on simulating the shortlist and keeping a shot that
actually drops, which is worth about seventy per cent of the games against the
same bot without it.

Every rack is reproducible: the same seed racks the same balls and plays the
same game, on any machine, however busy it is.

`node train/collect.js --games 400` runs that across every core and writes down,
for every turn, the position the player to move inherited and whether they went
on to win — which is the whole training set for a value function. The position
is taken *before* that player does anything, ball in hand included, because that
is exactly what the shot before it created, and judging what a shot leaves the
opponent is the question a player has to be able to answer.

`train/encode.js` is what a network would see: a coarse grid of where the balls
are, one channel for mine, one for theirs and one for the 8; where the cue ball
is and whether it is in hand; and what the shot geometry already knows — how
many pots are on and how straight the best one is. Everything is written from
the point of view of whoever is about to shoot, and by role rather than by
number, because the 3 and the 5 play identically and telling them apart would
only let a network learn the rack instead of the game.

### Learning to judge a position

**[`NETWORK.md`](NETWORK.md) is the reference for this section** — the encoder
feature by feature, the architecture, the training procedure and what the
shipped model scores. [`notebooks/value-network.ipynb`](notebooks/value-network.ipynb)
opens the weights that are in this repository and runs them: a forward pass in
four lines of numpy, the held-back scores reproduced from the same seeded
split, and a map of what the network thinks every cue-ball position on a real
table is worth.

It runs in Google Colab as it stands — **File → Open notebook → GitHub**, paste
`https://github.com/johnmerm/billard_js` and pick it. The first cell clones the
repo and installs node if they are not already there; with no `data/` to read,
it plays sixty racks of its own. No GPU, and nothing to configure.

`train/value.js` trains a small network on that data to answer one question:
you are about to shoot, here is the table — how often does this end with you
winning? Which shot to play then falls out of it as a search: try the pots the
geometry offers, simulate each one, and keep whichever leaves the opponent the
position the network likes least.

The train/validation split is by rack rather than by turn. Every turn in a rack
carries the same outcome and they all look much alike, so splitting by turn
would put near copies of the same position on both sides of the fence and
report a score that means nothing.

`train/player.js` is the player that results. For each pot the geometry offers
it plays the shot out in the simulator — softer, harder, with follow and with
draw — looks at the table each one leaves, and asks the network how good that
position is for whoever has to play it. Then it takes the shot whose aftermath
it likes best. The network never picks a shot and never aims; it only judges
positions, which is the one thing the simulator cannot do for itself.

    node train/selfplay.js --games 30 --a value:model/value --b search4

A first network, trained on 70,000 turns from 3,000 racks of the baseline bot
playing itself, beat that baseline **58-22** over eighty racks and its searching
version **49-31**. Against the searching one it potted slightly *fewer* balls
than its opponent — 5.9 a rack against 6.4 — so potting was not what it was
winning with. It was where it left the cue ball.

Then a second round: 36,000 turns from 2,400 racks of that player against
itself, and a new network trained on both rounds. Head to head against the first
one it went **21-19**. Nothing.

The reason turned out to have nothing to do with the network. Both were being
asked to choose between one shot per pot — the plain one, at one speed — so the
only decision either could make was *which ball*, not how to play it. A better
judge of positions is worth nothing if you cannot act on the judgement. Given
nine shots per pot instead of one, three speeds crossed with follow, draw and
neither, the same two models separate: **19-11** to the second. And the first
model, with that wider choice, goes from beating the searching bot 61% of the
time to **38-2**.

So the thing that was holding the player back was never how well it judged a
position. It was how few ways it was allowed to play the shot in front of it.
Worth remembering before reaching for a bigger network.

Eighty racks is about the smallest sample worth quoting. Twenty of them had the
first model at 14-6 against the searching bot, which looked like a far bigger
margin than the 61% it settled at — a couple of racks either way is ten points
at that size.

The network is honest about how hard the question is: it names the winner 75% of
the time one or two shots from the end and 55% at the break, against 58%
overall, where guessing the average would score 50%. That shape is the one to
want — a model confident about the break would have found something in the data
rather than in the game.

Training needs tensorflow.js, which is the one thing in this repo that comes
from npm — `npm install`, and only for the training tools. The game itself still
loads plain scripts and needs no build step and no package manager. The model is
saved in the layout `tf.loadLayersModel` expects, so the page can pick it up as
a static file like everything else.

### Retraining for a house rule, and why there is no model for one

There isn't one, and the attempt is worth recording rather than repeating.

These measurements were taken while the house rule was two: `blackbank`, which
demanded the 8 be banked in, and `blackkick`, which demanded the cue ball kick
first. Both of those are strictly harder than the one rule that replaced them —
either cushion satisfies it now — so the numbers below are a lower bound on how
the endgame goes today rather than a reading of it.

Wiring the cushion shots in fixed the house rules on its own. The baseline bot
went from 0 wins in 40 under `blackkick` to 29, and from 16 to 28 under
`blackbank`, with the standard-rules network untouched — giving it a legal shot
to choose was the whole of it. Retraining was always going to be a refinement
on top of that, not the repair.

So 800 racks were collected under `blackbank` — 12,997 turns, twenty minutes —
and trained at the same width as the shipped model. The result:

| | |
|---|---|
| best validation mse | 0.9984, at epoch 1, overfitting from epoch 2 |
| a constant 0.061 scores | **0.9962** |
| sign accuracy, held back | 51.3% |
| sign accuracy, training | 57.7% |

Guessing the same number every time beats it, and the six points between
training and held-back accuracy are memorisation. A null result, and a clean
one.

Round one needed ~70,000 turns to separate from its own baseline. This was a
fifth of that, on a rule that only changes the endgame, so the signal is
thinner still than the ratio suggests — the fraction of positions where the
rule alters anything at all is small. Five to eight times the data, two or
three hours of collecting, is the honest price of finding out whether the
refinement exists.

That cheaper question was asked instead, and it closed the matter. How often
each player finishes cleanly on the 8, rather than losing by putting it down
illegally — 24 racks each, the shipped model against itself and the baseline
bot against itself:

| | shipped model | baseline bot |
|---|---|---|
| standard rules | 21/24 (88%) | 17/24 (71%) |
| `blackbank` | **23/24 (96%)** | 15/24 (63%) |
| `blackkick` | **23/24 (96%)** | 16/24 (67%) |

And head to head under `blackbank`, the shipped model beats the baseline
**30-0** over thirty racks.

The model finishes *more* cleanly under a house rule than without one. The
likely reason is that the rule takes the straight pot away and leaves only
banks, which are softer shots that scratch less — the rule accidentally makes
the endgame safer for a player good enough to bank. Whatever the cause, there
is no weakness for retraining to recover, and the long collection was not run.

The order to do this in, learned the expensive way: measure whether the gap
exists before collecting data to close it. Twenty minutes of collecting and
twenty of training bought a null result that ten minutes of measuring would
have predicted.

The same 24 racks under the rule as it now stands — either cushion will do,
and a rattle in the mouth of the pocket is not one:

| | shipped model | baseline bot |
|---|---|---|
| standard rules | 21/24 (88%) | 17/24 (71%) |
| `blackcushion` | **23/24 (96%)** | 16/24 (67%) |

The shape holds: the model finishes *more* cleanly with the rule on than
without it, and the baseline bot slightly less cleanly. Nothing there for
retraining to recover either.

Five of the model's 23 clean finishes under the rule were kick *and* bank in
the same shot, against none of the 21 without it. That is the shot the rule is
really describing, and a player good enough to kick at the black finds it
about one rack in five — which is worth knowing before turning the celebration
up any further.

### Playing against it

Each player's line in the score panel carries a small **AI** chip. Pressing it
hands that seat to the network; pressing it again takes the seat back. Either
seat, or both — with both taken the game plays itself, racking up again a few
seconds after each one finishes, which is the easiest way to see what it has
learned.

While the network has a seat, the cloth, the buttons, the spin dial and the shot
keys are all ignored for that turn — a stray click cannot take the shot for it.

It takes its shot the way a person does rather than the way a program would,
and in no hurry. Played at the speed a person plays at, its turns go by faster
than they can be read: the cue appears at an angle, the balls move, and whatever
it was doing is over before you have found the ball it was aiming at. So it
lingers on the line for a second with the guides showing, says which ball it is
going for, draws back slowly enough to watch, rolls the balls at about two
thirds speed, and waits a beat afterwards before starting on the next one. Your
own shots are unaffected — you are watching your own cue ball and do not need
the help.

**Hint**, or **H**, asks the same question without handing over the table. It
sets the aim, the spin and the cue angle to the shot it would play, so the
guides on the cloth show what it means, and marks the power bar at the speed it
chose. How hard to hit it is still yours: hold SHOOT and let go at the mark. Ask
it with the ball in hand and it marks the spot to put it down instead.

It plays the same code the trainer does — `geometry.js` finds the pots,
`match.js` plays each one out in the physics, `encode.js` describes what it
leaves behind and the network says how much it likes that — so what you play
against is exactly what was measured, not a reimplementation of it.

Two things the page needs that the trainer did not. Tensorflow is a megabyte and
a half, so it is fetched the first time somebody switches the opponent on and
never otherwise; the button says what it is doing while that happens. And
thinking about a turn means simulating a couple of dozen shots, which is most of
a second, so the search is handed back as something steppable and the page
spends a few milliseconds of each frame on it. The table goes on drawing while
it thinks — frames get longer, because one simulated shot cannot be interrupted
partway, but nothing stops.

The one thing that does not work from a `file://` page is the AI, because
browsers will not let a script fetch the model off the local disk. Everything
else plays exactly as it does over http, and the button says so rather than
failing quietly.

## About the physics

cannon-es runs the simulation. The balls are rigid spheres with friction against
the cloth, and the cue strike is an impulse applied off centre, so draw, follow,
stun and english are not special cases anywhere in this repo — they fall out of
where the tip meets the ball. Hit it below centre and it comes back; hit it above
and it follows through.

`phys.js` is the table around that:

- **A pocket is an absence, not a trigger.** A ball whose centre is over a mouth
  has nothing under it and nothing to hit — not the cloth, not the cushion
  skirts — so it falls, keeping whatever speed and spin it arrived with, and you
  watch it go down. It counts as potted when it passes below the bed. Until its
  centre is over the hole it collides with everything as usual, so it can still
  rattle off a jaw and stay up.

  Cutting an actual hole in the bed was the obvious way to do that and it does
  not work: a ball rests wherever any part of it can reach cloth, so a hole the
  size of the mouth leaves a lip a ball wide that a ball sits on, more than half
  over the pocket — which is the hovering it was meant to fix. Making the hole a
  ball wider swallows balls that are still on the cloth. The mouths are drawn at
  exactly the size the physics uses, so a ball that looks like it is over the
  hole is a ball on its way down.
- **Cushions are boxes** built from a list of segments that stop short of each
  pocket and are cut back at 45 degrees. The renderer builds the visible rubber
  from the same list, so what you see is what you hit, jaws included.
- **The cloth is modelled here, not by the solver.** cannon's friction turns a
  sliding ball into a rolling one in about eight milliseconds where the real
  thing takes the best part of a second, and it barely responds to the friction
  coefficient at all. That transition *is* draw and follow: a ball struck low
  has to hold its backspin long enough to reach the object ball. So the cloth
  contact is frictionless as far as cannon is concerned, and the patch where
  ball meets cloth is worked out in a `preStep` hook — kinetic friction against
  the slipping patch while it slides, rolling resistance once it rolls. A heavy
  draw shot now slides for 0.91 s and settles to 0.71 m/s, which is what the
  textbook says it should.
- **The cloth lets go during a collision.** A ball on ball hit is over in a
  fraction of a millisecond, far too little time for the cloth to matter, but
  the solver resolves it in one step with an enormous normal force and the
  friction rides along with it. That scrubbed the cue ball's spin off at exactly
  the moment it mattered, and handed it to the object ball, which came out of
  the collision already rolling.
- **The balls are given a sphere's inertia.** cannon works it out from a body's
  bounding box, which for a sphere is the box around it: 2/3 m r², the figure
  for a hollow shell, two thirds again too hard to turn. Every bit of spin came
  out at 60% strength until this was set explicitly.
- **Sleeping is off.** cannon leaves sleeping bodies out of the solver, so a ball
  that had dozed off swallowed part of the impulse when it was hit. The rest
  clamp in the cloth pass does that job instead, and it only holds a ball that
  has no spin left to act on — a cue ball stopped dead with topspin on it is not
  at rest, it is about to follow through.
- **The rails are built shoulder high and hold the ball down.** A box shaped
  cushion gets one thing badly wrong: a real cushion meets the ball above its
  equator, so its nose pushes down as well as back, while a flat vertical face
  lets a ball arriving with heavy topspin climb it. At break speed that threw
  the cue ball 19 cm into the air and clean off the end of the table. The lift
  is taken back out after the solver runs, and the cushion bodies are built
  taller than any ball so a fast one cannot resolve its way over the top — the
  renderer still draws the rubber at its proper height.
- **Ball on ball friction is kept low.** At this scale cannon's friction impulse
  is generous, and anything higher spins the object ball up at the expense of
  the speed it should be leaving with.
- **Fixed 1/480 s steps**, with cannon sub-stepping to catch up. A hard break
  moves a ball about 8 m/s, or 17 mm a step, comfortably less than a ball
  radius, so nothing tunnels through the rack.

Two coordinate systems meet in `phys.js`. The game thinks in table coordinates —
x along the length, y across the width, both from a corner — while cannon and
three.js share a y-up world centred on the table. Positions and directions are
converted; orientations never are, because the renderer copies ball quaternions
straight off the bodies.

Units are SI: a 2.24 x 1.12 m playing surface, 57.15 mm balls, 170 g each.
