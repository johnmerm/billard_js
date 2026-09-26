/**
 * train/match.js - a game of eight ball with no browser anywhere near it.
 *
 * Same physics, same rulebook, no renderer and no clock: a shot is played by
 * stepping the table until it stops rather than by waiting for frames, so a
 * rack takes a couple of seconds instead of a couple of minutes. That is what
 * makes self play possible at all.
 *
 * Everything here is deterministic given a seed, which matters more than it
 * sounds: a player that looks stronger over fifty games has to be checked
 * against the same fifty racks, not fifty new ones.
 */
/*
 * Loaded twice over: by node with `require`, and by the page as a plain script
 * where the modules it needs are already globals. Hence the pattern below -
 * take what is on the page if it is there, ask node for it if it is not.
 */
var Phys = typeof Phys !== 'undefined' ? Phys : require('../phys.js');
var Rules = typeof Rules !== 'undefined' ? Rules : require('../rules.js');

var TABLE_W = 2.24, TABLE_H = 1.12;
var MIN_POWER = 0.6, MAX_POWER = 9.0;

/** xorshift32: small, seedable, and the same on every machine. */
function rng(seed) {
    var x = (seed | 0) || 0x2545f491;
    return function () {
        x ^= x << 13; x |= 0;
        x ^= x >>> 17;
        x ^= x << 5; x |= 0;
        return ((x >>> 0) % 0x100000000) / 0x100000000;
    };
}

function shuffle(a, rand) {
    for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(rand() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}

/** Apex on the foot spot, the 8 in the middle, one of each in the back corners. */
function rackOrder(rand) {
    var solids = shuffle([2, 3, 4, 5, 6, 7], rand);
    var stripes = shuffle([9, 10, 11, 12, 13, 14, 15], rand);

    var slots = new Array(15);
    slots[0] = 1;
    slots[4] = 8;
    slots[10] = solids.pop();
    slots[14] = stripes.pop();

    var rest = shuffle(solids.concat(stripes), rand);
    for (var i = 0; i < 15; i++) {
        if (slots[i] === undefined) slots[i] = rest.pop();
    }
    return slots;
}

/** A fresh table with a full rack on it. */
function setup(rand) {
    var world = Phys.createTable({width: TABLE_W, height: TABLE_H});
    for (var id = 0; id < 16; id++) world.add(new Phys.Ball(id, 0, 0));

    var r = world.radius, gap = 2 * r * 1.02, foot = TABLE_W * 0.72;
    var order = rackOrder(rand), n = 0;
    for (var row = 0; row < 5; row++) {
        for (var j = 0; j <= row; j++) {
            world.ball(order[n++]).placeAt(foot + row * gap * 0.866,
                TABLE_H / 2 + (j - row / 2) * gap);
        }
    }
    world.ball(0).lift();          // ball in hand to start, as on the page
    return world;
}

/**
 * Run the table until nothing is moving.
 *
 * The cap is a safety net rather than a rule: a ball wedged in a pocket jaw
 * would otherwise spin forever and take the whole run with it.
 */
function settle(world, shot, maxSeconds) {
    var dt = 1 / 120, t = 0, limit = maxSeconds || 40;
    while (!world.atRest() && t < limit) {
        Rules.track(shot, world.step(dt));
        t += dt;
    }
    return t;
}

/**
 * Play one shot and judge it.
 *
 * @param {Object} world   the table, which this does change
 * @param {Object} pos     {groups, player, open, broken}
 * @param {Object} params  {angle, power, side, vert, elevation}
 * @return {Object} the rulebook's verdict, plus the shot record
 */
function playShot(world, pos, params) {
    var shot = Rules.newShot(world, pos.groups, pos.player, pos.broken);
    world.strike(world.ball(0), Math.cos(params.angle), Math.sin(params.angle),
        Math.max(MIN_POWER, Math.min(MAX_POWER, params.power)),
        params.side || 0, params.vert || 0, params.elevation || 0);

    var seconds = settle(world, shot);
    var out = Rules.resolve(world, pos, shot);
    out.shot = shot;
    out.seconds = seconds;
    return out;
}

/** Fold a verdict back into the position, the way game.js does on the page. */
function apply(world, pos, out) {
    if (out.respotEight) Rules.respot(world, world.ball(8));
    if (out.groups) {
        pos.groups = [out.groups[0], out.groups[1]];
        pos.open = out.open;
    }
    pos.broken = true;
    pos.player = out.player;
    pos.ballInHand = !!out.ballInHand;
    pos.kitchenOnly = !!out.kitchenOnly;
    return pos;
}

/**
 * Play a whole rack.
 *
 * A player is {place(world, pos) -> {x, y}, shoot(world, pos) -> params}. It is
 * asked to place the cue ball whenever it has ball in hand, which includes the
 * break, and to name a shot otherwise.
 *
 * @return {Object} {winner, why, shots, fouls, pots, log, seconds}
 */
function playGame(players, opts) {
    opts = opts || {};
    var rand = rng(opts.seed || 1);
    var world = opts.world || setup(rand);

    var pos = {
        groups: [null, null], player: 0, open: true, broken: false,
        ballInHand: true, kitchenOnly: true
    };

    var log = [], fouls = [0, 0], pots = [0, 0], seconds = 0;
    var maxShots = opts.maxShots || 120;

    for (var n = 0; n < maxShots; n++) {
        var player = players[pos.player];

        // the position as the player to move inherits it, ball in hand and all:
        // that is what the shot before it created, and what a value function has
        // to be able to judge
        if (opts.observe) opts.observe(world, pos, n);

        if (pos.ballInHand) {
            var spot = player.place(world, pos);
            if (!spot || !Rules.placementLegal(world, spot.x, spot.y, pos.kitchenOnly)) {
                // a player that cannot find a legal spot forfeits the rack: it
                // is a bug in the player, and silently fudging it would hide it
                return {winner: 1 - pos.player, why: 'no legal placement',
                    shots: n, fouls: fouls, pots: pots, log: log, seconds: seconds};
            }
            world.ball(0).placeAt(spot.x, spot.y);
            pos.ballInHand = false;
            pos.kitchenOnly = false;
        }

        var params = player.shoot(world, pos);
        if (!params) {
            return {winner: 1 - pos.player, why: 'no shot offered',
                shots: n, fouls: fouls, pots: pots, log: log, seconds: seconds};
        }

        var shooter = pos.player;
        var out = playShot(world, pos, params);
        seconds += out.seconds;

        if (out.foul) fouls[shooter]++;
        pots[shooter] += out.potted.length;
        log.push({
            player: shooter, params: params, first: out.shot.first,
            potted: out.potted.slice(), foul: out.foul, message: out.message
        });

        if (out.gameOver) {
            return {winner: out.gameOver.winner, why: out.gameOver.why,
                flourish: !!out.flourish,
                shots: n + 1, fouls: fouls, pots: pots, log: log, seconds: seconds};
        }
        apply(world, pos, out);
    }

    return {winner: null, why: 'ran out of shots', shots: maxShots,
        fouls: fouls, pots: pots, log: log, seconds: seconds};
}

/* The page needs this as a global; node needs it on module.exports. */
var Match = {
    TABLE_W: TABLE_W, TABLE_H: TABLE_H,
    MIN_POWER: MIN_POWER, MAX_POWER: MAX_POWER,
    rng: rng, setup: setup, settle: settle,
    playShot: playShot, apply: apply, playGame: playGame
};
if (typeof module !== 'undefined' && module.exports) module.exports = Match;
