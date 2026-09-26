# The value network

The page ships a neural network of 15,265 parameters — sixty kilobytes — that
has never been told how to aim, how hard to hit anything, or what a pocket is.
It answers one question, and the player is built around that question.

> You are about to shoot. Here is the table. How often does this end with you
> winning?

That is the whole of what is learned. Which shot to play then falls out of it
as a search: try the pots the geometry offers, play each one out in the
simulator, and keep whichever leaves the opponent the position the network
likes least.

This file is the reference. `README.md` § *Playing it without a browser* tells
the story of how it went; `notebooks/value-network.ipynb` opens the shipped
weights and shows them working. To read this rendered rather than raw, open
`docs.html?doc=NETWORK.md` beside it.

The notebook needs numpy, matplotlib and node, and runs in Google Colab as it
stands — **File → Open notebook → GitHub**, paste
`https://github.com/johnmerm/billard_js`, pick it, and run. Its first cell
clones the repo and installs node if they are not already there, and since
there is no `data/` in the repository it plays sixty racks of its own to score
the model on. No GPU: the model is 15,265 parameters and the slow part is the
billiards.

---

## Why a value function

A billiards player has to answer two questions: *which shot* and *how to play
it*. The second one is physics, and the physics is already here and exact —
cannon-es will tell you precisely where every ball ends up, for free, for any
shot you care to name. Asking a network to predict that would be asking it to
be a worse simulator.

What the simulator cannot do is tell you whether the table it just produced is
a good one. That judgement is what the network is for, and it is the only thing
it is for:

| | who does it |
|---|---|
| which pots exist, at what cut angle, past which ball | `train/geometry.js`, exactly |
| what happens if I play this one | `phys.js`, exactly |
| is the table it leaves any good | **the network** |
| so which shot do I take | `train/player.js`, by comparing |

The network never picks a shot and never aims. It scores positions, one number
each, and the search does the rest.

---

## The shape of it

```
109 inputs  ->  96 relu  ->  48 relu  ->  1 tanh
```

15,265 parameters. `tanh` on the output because the thing being predicted is a
win or a loss and nothing outside ±1 means anything.

Built in `train/value.js`:

```js
model.add(tf.layers.dense({inputShape: [109], units: 96, activation: 'relu'}));
model.add(tf.layers.dense({units: 48, activation: 'relu'}));
model.add(tf.layers.dense({units: 1, activation: 'tanh'}));
model.compile({optimizer: tf.train.adam(0.002), loss: 'meanSquaredError'});
```

Three layers and no convolutions, on purpose. The hard, structured part of
seeing a billiards table — which balls can reach which pockets, what is in the
way — is geometry that `geometry.js` computes exactly and hands over as
features. A network asked to rediscover it from raw coordinates would need to
be far larger, would need far more data, and would still be worse at it.

Sixty kilobytes also means the page can fetch it as a static file beside
everything else, which is the difference between a model that ships and one
that lives in a notebook.

---

## What it sees

`train/encode.js` turns a table into 109 numbers, all in 0..1. Two rules
govern the whole encoding:

**Everything is from the point of view of whoever is about to shoot.** Not
"player 1" and "player 2" — *mine* and *theirs*. The same position with the
seats swapped is a different input, and it should be: it is a different
question.

**Nothing is identified by ball number.** In eight ball the 3 and the 5 play
identically. Telling them apart would ask the network to learn the same lesson
fifteen times and hand it a way to memorise racks instead of learning the game.

### The three groups

| index | count | what |
|---|---|---|
| 0–31 | 32 | **mine**: occupancy of an 8×4 grid, +0.34 a ball, saturating at 1 |
| 32–63 | 32 | **theirs**: the same grid for the opponent's half |
| 64–95 | 32 | **the eight**: the same grid again, for one ball |
| 96 | 1 | `cue.x` — cue ball across the table, 0..1 |
| 97 | 1 | `cue.y` — cue ball up the table, 0..1 |
| 98 | 1 | `cue.inHand` — 1 when the cue ball is in hand, which is worth a lot |
| 99 | 1 | `mineLeft` — how many of mine are up, over 7 |
| 100 | 1 | `theirsLeft` — how many of theirs are up, over 7 |
| 101 | 1 | `open` — 1 while neither player owns a half |
| 102 | 1 | `onEight` — 1 when the 8 is the legal target |
| 103 | 1 | `ahead` — `(mineLeft - theirsLeft) / 7 * 0.5 + 0.5` |
| 104 | 1 | `shots` — how many pots are on, over 8, capped |
| 105 | 1 | `bestCut` — `cos` of the straightest pot's cut angle; 1 is dead straight |
| 106 | 1 | `bestDistance` — cue ball to that ball, over the table's reach |
| 107 | 1 | `bestToPocket` — that ball to its pocket, over the same |
| 108 | 1 | `secondCut` — `cos` of the second pot's cut, or 0 if there is only one |

`Encode.labels()` returns those names in order, and every dataset writes them
into its `meta.json`, so a file can always say what its columns were.

### Why the grid is coarse

Eight by four cells is about a foot square each. That is nowhere near enough to
work out whether a pot is on — and it does not have to be, because
`bestCut`, `bestDistance` and `shots` already say so exactly. What the grid is
for is the shape of the table: are my balls spread out or stacked in a corner,
is theirs a cluster, where is the 8 relative to both. A finer grid would cost
parameters to say something the shortlist features already say better.

Occupancy saturates at 1 for the same reason: a fresh rack puts seven balls in
one cell, and without a cap that one number would swamp everything else the
network is looking at.

### Why the shortlist features are in there at all

`shots`, `bestCut`, `bestDistance`, `bestToPocket` and `secondCut` come from
`Geometry.shortlist` — the same function the player uses to decide what to
simulate. They are five numbers out of 109 and they carry most of the signal,
because "is there a pot on, and how straight is it" is most of what a position
is worth.

They are also the *rule-aware* list. Under the house rule on the black, a
straight pot on the 8 is not a legal finish and does not appear, so `shots`
falls to whatever banks and kicks exist. Feeding the rule-blind list would
teach a network that the endgame is easier than it is.

---

## Where the data comes from

`train/collect.js` plays racks across every core and writes down, for every
turn, the position the player to move inherited and whether that player went on
to win.

```
node train/collect.js --games 400 --workers 4 --out data/v1
```

**The position is taken before that player does anything**, ball in hand
included. That is exactly what the previous shot created, and "what did that
shot leave the opponent" is the question the search needs answered.

**The label is the outcome of the whole rack**, ±1, not a per-shot judgement.
There is no reward shaping and no credit assignment: if you were at the table
here and you won, this position gets +1. Over tens of thousands of turns the
noise cancels and what is left is how often a position of this shape ends well.
Unfinished racks — the shot cap ran out — carry no label and are dropped.

Each row also records **`ply`**, how many turns from the end it was. It is not
an input to the network; it is there so a report can ask whether the model is
confident in the right places.

### On disk

Flat `float32`, no header, one row after another:

```
[ 109 features ][ label ][ ply ]     stride 111 floats = 444 bytes
```

One shard per worker, plus a `meta.json` holding the encoder version, the
labels, the row counts and the settings the games were played with. Reading a
shard is `np.fromfile(path, '<f4').reshape(-1, 111)` and nothing else.

`data/` is not in the repository — a few hours of racks is tens of megabytes
and none of it is source. Regenerate it with the command above.

### The two rounds that made the shipped model

| | racks | turns | played by |
|---|---|---|---|
| `data/v1` | 3,000 | 69,984 | the baseline bot against itself |
| `data/v2` | 2,397 | 36,348 | the first network against itself, with 15% exploration |

The shipped model is trained on both. The older games are worse, but they visit
positions the current player has learned to steer around and would otherwise
never see again — so a round of training keeps its predecessors' data rather
than replacing it.

The exploration matters: a player that always takes what it already believes is
best only ever shows itself positions it already understands. `--explore 0.15`
makes it play something else on purpose, one turn in seven.

Every rack is reproducible. The same seed racks the same balls and plays the
same game, on any machine, however busy it is — the headless simulator steps a
fixed quantum, unlike the page, which is driven by the wall clock.

---

## How it is trained

```
node train/value.js --data data/v1,data/v2 --out model/value --width 96
```

| | |
|---|---|
| loss | mean squared error against ±1 |
| optimiser | Adam, learning rate 0.002 |
| batch | 256, shuffled |
| epochs | up to 40, stopping after 6 without improvement |
| weights kept | the best validation epoch's, not the last |
| validation | 12% of **racks**, seeded so the split is reproducible |

### The split is by rack, not by turn

Every turn in a rack carries the same label and they all look much alike. Split
by turn and near-copies of the same position land on both sides of the fence,
the validation score measures memorisation, and it reports a number that means
nothing. `rackStarts` finds the boundaries by watching `ply` stop counting
down, and whole racks go to one side or the other.

This is the single easiest mistake to make here and the hardest to notice
afterwards, because getting it wrong makes the numbers look *better*.

### What the shipped model scores

On the 106,332 turns of `data/v1,data/v2`, split at 12% of 5,397 racks:

| | training | held back |
|---|---|---|
| turns | 93,695 | 12,637 |
| mse | 0.9234 | **0.9535** |
| sign right | 60.8% | **58.4%** |

A constant predictor — always guessing the mean, 0.074 — scores mse **0.9945**
on the same held-back rows, and 50% on sign. So the model is worth about four
points of mse and eight points of accuracy over knowing nothing.

That sounds thin until you look at *where* the accuracy is:

| turns from the end | held-back accuracy | of |
|---|---|---|
| 1–2 | **75.3%** | 1,296 |
| 3–5 | 60.0% | 1,937 |
| 6–10 | 56.7% | 3,081 |
| 11+ | 55.2% | 6,323 |

This is the shape to want. A position one shot from the end is nearly decided
and the model can see it; a position at the break is close to a coin toss and
the model says so. **A model that was confident about the break would have
found something in the data rather than something about the game** — the rack
order, the seed, the bot's habits — and would be worse on a real table while
scoring better on paper.

Mean squared error alone would not have told you any of that, which is why
`report()` prints the buckets.

---

## How it plays

`train/player.js`, for each turn:

1. Ask `Geometry.shortlist` for the pots that are on, rule-aware, straightest
   first. If there are none, play the baseline bot's safety.
2. Take the first `shots` of them (default 3) and expand each into
   `variations` — `spread: 1` is the plain shot, `2` adds softer (×0.8) and
   harder (×1.35), `3` crosses those with follow and draw. So 1, 3 or 9
   simulated shots per pot.
3. Play each one in the simulator from a snapshot of the real table, and look
   at what it leaves.
   - A shot that ends the game scores ±10⁶ outright — no network needed.
   - Otherwise encode the resulting position and note whose turn it is.
   - A foul carries a 0.15 penalty on top of the position: the opponent gets
     ball in hand, which the position alone does not say.
4. Judge every candidate in one batch. The network always answers from the
   shooter's point of view, so a position left to the opponent is negated
   before it can be compared with one left to us.
5. Take the best. When collecting data, take something else entirely with
   probability `explore`.

One batch rather than one call per shot: the network is tiny and tensorflow's
per-call overhead dwarfs the arithmetic, so every shot in a turn is played
first and they are all judged together.

It is a one-move search. Two would be better and costs the square.

---

## What this exercise actually taught

**The action space was the bottleneck, not the network.** A second round of
training produced a model that beat the first 21–19 — nothing. Both were being
asked to choose between one shot per pot, so the only decision either could
make was *which ball*, never how to play it. Given nine shots per pot instead
of one, the same two models separate 19–11, and the *first* model goes from
beating the searching bot 61% of the time to 38–2. A better judge of positions
is worth nothing if you cannot act on the judgement.

**The same thing happened again with the house rule.** Measured while the rule
was still split in two: under the kick half of it the baseline bot won 0 racks
in 40 — not because it judged the endgame badly but because the shortlist
offered it no legal shot to take. Wiring the cushion shots in took it to 29 in
40 with the network untouched. Then 800 racks were
collected under the rule and trained anyway: validation mse 0.9984 against a
constant predictor's 0.9962, held-back sign accuracy 51.3% against 57.7% on
the training rows. Guessing the same number every time beat it. The model was
deleted rather than shipped, and `README.md` carries the full post-mortem.

The order to do these things in, learned the expensive way: **measure whether
the gap exists before collecting data to close it.**

**The margin is a judgement about a population of games, not a fact about
billiards.** On its own held-back racks the model calls 58.4% of signs right.
Shown 866 turns of the *searching* bot's games — a player it was never trained
on — it calls 52.9%, and the constant predictor beats it on mse. On 1,936
turns of the greedy bot's games, which is who played `data/v1`, it gets 61.0%.
Small samples, and the direction is unmistakable: a value function
learns the positions its training players steer into, and a better player
steers somewhere else. That is the standing argument for collecting a new
round of data every time the player improves, which is what `data/v2` is.

**Eighty racks is about the smallest sample worth quoting.** Twenty of them had
the first model at 14–6 against the searching bot, which looked like a far
bigger margin than the 61% it settled at.

---

## Reproducing the whole thing

```bash
npm install                                    # tfjs, and only for training

node train/collect.js --games 3000 --search 0 --out data/v1   # a few hours on 4 cores
node train/value.js --data data/v1 --out model/value

node train/collect.js --games 2400 --out data/v2 \
     --player model/value --explore 0.15
node train/value.js --data data/v1,data/v2 --out model/value --width 96

node train/selfplay.js --games 30 --a value:model/value --b search4
```

Nothing in the game itself needs npm. `npm install` is for the training tools;
the page loads plain scripts and the model as a static file.

---

## The files

| file | what it is |
|---|---|
| `train/encode.js` | a table as 109 numbers. The only definition of what the network sees |
| `train/collect.js` | self play across every core, written down as labelled rows |
| `train/value.js` | the network, the training loop, the split, the report, save and load |
| `train/player.js` | the player built on the network: shortlist, simulate, judge, choose |
| `train/geometry.js` | the pots that exist, and what a cushion shot looks like |
| `train/match.js` | a headless rack: shots, rules, an outcome |
| `train/bot.js` | the baseline, and the snapshot/restore the search runs on |
| `train/dump.js` | positions and features as json, for anything outside node |
| `model/value/` | the shipped weights, in the layout `tf.loadLayersModel` expects |
| `notebooks/value-network.ipynb` | the weights opened up and made to work |

The encoder runs unchanged in node and in the browser — the same file, loaded
as a module in one and as a plain script in the other. If those two ever
disagreed, the network would be answering questions in a language nobody taught
it.
