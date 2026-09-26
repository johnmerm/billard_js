# Playing eight ball from a terminal

You are one of two agents playing a game of eight ball against each other. The
game is running in a Chrome window on this machine and somebody is watching it,
so the interesting part is not only which shot you take but that you say why.

## Your seat

Whoever started you said whether you are player 1 or player 2. Pass that number
as the last argument of every call. It is what stops you moving on your
opponent's turn — without it the page cannot tell the two of you apart, and a
stray call plays *their* shot for them.

## Reaching the game

The game is a page in a Chrome that is already running with a debugging port
open on `127.0.0.1:9222`. You talk to the page, not to a program that wraps it.

**If you have a browser tool** — a Chrome extension, a devtools or playwright
MCP server, anything that evaluates javascript in a tab — use it, and skip the
rest of this section. Call `window.Billiards.*` directly. The one thing to know
is that `play` and `aim` return promises that settle when the balls stop, so
your tool has to await them; if it does not, fire the shot and then poll
`Billiards.state.phase` until it is no longer `rolling`.

**If all you have is a shell**, define this once and use it for everything:

```bash
cdp() { node -e '
const res=await fetch("http://127.0.0.1:9222/json/list").catch(()=>null);
if(!res){console.log("No Chrome on 127.0.0.1:9222.");process.exit(1)}
const t=await res.json();
const w=new WebSocket(t.find(x=>x.url.includes("index.html")).webSocketDebuggerUrl);
w.onopen=()=>w.send(JSON.stringify({id:1,method:"Runtime.evaluate",
  params:{expression:process.argv[1],awaitPromise:true,returnByValue:true}}));
w.onmessage=e=>{const r=JSON.parse(e.data).result;
  console.log(r.exceptionDetails?r.exceptionDetails.exception.description:r.result.value);
  process.exit(0)};' "$1"; }
```

Then `cdp 'Billiards.brief(1)'` prints the table. It needs nothing installed:
node 22 has both `fetch` and `WebSocket` built in, and `awaitPromise` is what
lets a whole shot be a single call.

There is also `node tools/drive.js` in this repository, which wraps the same
calls as subcommands. You do not need it, and going through the page directly
is better: you can compose. `Billiards.brief()` is a string you can filter,
`Billiards.state.groups` is readable, and you can work out something about the
ball positions inside the page rather than in your head.

## The loop

1. `Billiards.awaitTurn(<seat>)` — resolves with the table when it is your go.
2. Read it. Say in a sentence what you are going for and why.
3. `Billiards.play(<n>, <power>, <side>, <vert>, <seat>)` — takes pot `n` from
   the list you were just shown, and resolves when the balls have stopped with
   what happened.
4. Back to 1.

Stop when a reply tells you the game is over.

## The calls

| call | what it does |
|---|---|
| `Billiards.awaitTurn(seat)` | block until your turn, then give the position |
| `Billiards.brief(seat)` | the position now, without waiting |
| `Billiards.play(n, power, side, vert, seat)` | take pot `n` from the brief's list |
| `Billiards.aim(x, y, power, side, vert, seat)` | shoot at a point instead of a listed pot |
| `Billiards.placeCue(x, y, seat)` | put the cue ball down while it is in hand |
| `Billiards.state` | the raw game state, if you want to read it yourself |

- `power` runs 0 to 1: 0 is the softest roll the cue can give, 1 is everything.
- `side` is left/right english, `vert` is draw (negative) to follow (positive).
  Both run -1 to 1, though anything past about 0.7 is clamped. Pass 0 for
  neither until you have a reason.
- Positions are in centimetres, the same units the brief prints.

## What the brief tells you

- **Which balls are yours**, how many are left, and whether your opponent is on
  the 8 — that last one decides whether you can afford a safety.
- **Every ball's position**, in cm, on a 224 x 112 table with the origin at a
  corner.
- **Your pots, straightest first**, numbered. `cut` is how thin the contact is:
  0° is dead straight and nearly always drops, past about 45° it gets
  unreliable. `cue->ball` and `ball->pocket` are the two distances the shot has
  to cover.
- **Not on** — pots that exist but are blocked, and the ball in the way. This is
  how you tell being snookered from simply having nothing straight. They want
  opposite shots.

When the cue ball is in hand the brief says so and offers no pots: place it
first, then ask for a brief again.

## Judging a shot

The pot list is aiming geometry and nothing else. It knows exactly where to hit
the ball and nothing at all about where the cue ball ends up afterwards. That
gap is where shots are actually lost, so the numbers below are worth having.
Each is 450+ shots played headlessly, always taking pot `[1]` with the stated
power and spin:

| habit | pots | scratches | misses |
|---|---|---|---|
| power 0.55, no spin | 66% | **12%** | 22% |
| power 0.55, draw -0.5 | 64% | 18% | 18% |
| power 0.55, follow +0.5 | 63% | 17% | 19% |


Read those honestly rather than as a rule to follow:

- **Scratching is the main way you lose a turn**, not missing. A straight pot
  sends the cue ball along the line the object ball just took — which points at
  the pocket the object ball went into.
- **Power is the lever that matters, and most shots want less of it than you
  think.** Hitting at 0.30 rather than 0.55 pots more *and* misses less: the
  shot only has to reach the pocket, not arrive hard. 0.80 is worse at
  everything. Save real power for an object ball genuinely far from the pocket,
  or for when you need the cue ball to travel afterwards.
- **Draw depends entirely on the power under it.** At 0.55 it makes scratching
  worse; at 0.30 it nearly halves it. Spin does not rescue a shot that is
  already too hard — on a soft shot it holds the cue ball back off the pocket it
  just fed. Never reach for spin to fix a power problem.
- **Soft with a touch of draw is the best habit measured**, and it is a starting
  point rather than a rule. It is blind to the position in front of you, which
  is exactly the thing you can see and it cannot.

The brief tells you where every ball is, so you can work out roughly where the
cue ball is heading after a pot and whether a pocket is waiting there. That
reasoning is the whole game and no tool does it for you.

## House rules

- **Do not edit any code.** You are playing, not developing. If something looks
  broken, say so and keep playing.
- **Do not call `Billiards.newGame`.** It restarts the game under your
  opponent, mid-rack, with no warning to either of you.
- **Do not use git** or change anything in the repository.
- **`awaitTurn` can block for minutes** while your opponent thinks. Give the
  call a generous timeout. If it times out anyway, just make it again — asking
  again retires the earlier wait rather than queueing another one.
- **One shot per turn.** After `play` returns, go back to `awaitTurn`: the reply
  already tells you whether the turn stayed with you, but `awaitTurn` is what
  keeps the two of you from talking over each other.
- **Narrate briefly.** A sentence before each shot and a reaction after it. The
  person watching is reading your terminal, not the code.
