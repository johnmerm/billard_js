# Playing eight ball from a terminal

You are one of two agents playing a game of eight ball against each other. The
game is running in a Chrome window on this machine and somebody is watching it,
so the interesting part is not only which shot you take but that you say why.

## Your seat

Whoever started you said whether you are player 1 or player 2. Pass that number
to every command. It is what stops you moving on your opponent's turn — without
it the page cannot tell the two of you apart, and a stray command plays *their*
shot for them.

## The loop

Your whole interface is `node tools/drive.js`, run from the repository root.

1. `node tools/drive.js wait <seat>` — blocks until it is your turn, then prints
   the table.
2. Read it. Say in a sentence what you are going for and why.
3. `node tools/drive.js play <n> <power> <side> <vert> <seat>` — takes pot `n`
   from the list you were just shown. It returns when the balls have stopped and
   tells you what happened.
4. Back to 1.

Stop when a command tells you the game is over. The tool also exits with code 2
at that point, so a `while` loop ends by itself.

## The commands

| command | what it does |
|---|---|
| `wait <seat>` | block until your turn, then print the position |
| `brief <seat>` | print the position now, without waiting |
| `play <n> <power> <side> <vert> <seat>` | take pot `n` from the brief's list |
| `aim <x> <y> <power> <side> <vert> <seat>` | shoot at a point instead of a listed pot |
| `place <x> <y> <seat>` | put the cue ball down while it is in hand |
| `state` | one line: phase, whose turn it is |

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
- **Spin is not the easy fix it looks like.** Both draw and follow made things
  worse here, not better. That is measured, not folklore. If you use spin, have
  a reason for it and watch what it actually does.
- **Power is the untested lever.** Less power means less travel after contact,
  which ought to mean fewer scratches — but that has not been measured, so treat
  it as a hypothesis you are testing rather than a rule.

The brief tells you where every ball is, so you can work out roughly where the
cue ball is heading after a pot and whether a pocket is waiting there. That
reasoning is the whole game and no tool does it for you.

## House rules

- **Do not edit any code.** You are playing, not developing. If something looks
  broken, say so and keep playing.
- **Do not run `rack`.** It restarts the game under your opponent.
- **Do not use git** or change anything in the repository.
- **`wait` can block for minutes** while your opponent thinks. Give the command
  a generous timeout. If it times out anyway, just run it again — asking again
  retires the earlier wait rather than queueing another one.
- **One shot per turn.** After `play` returns, go back to `wait`: the reply
  already tells you whether the turn stayed with you, but `wait` is what keeps
  the two of you from talking over each other.
- **Narrate briefly.** A sentence before each shot and a reaction after it. The
  person watching is reading your terminal, not the code.
