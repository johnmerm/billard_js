/**
 * rules.js - eight ball, and nothing else.
 *
 * The rulebook used to live inside game.js, tangled up with the HUD text and
 * the phase machine, which meant nothing outside a browser could play a legal
 * game - no headless match, no self play, no way to check the rules without
 * driving a page. So it is pulled out here, and `resolve` is a function rather
 * than a procedure: it reads a shot and says what happened, changing nothing.
 * Whoever called it decides what to do about it - game.js moves its own state
 * and writes on the screen, a trainer keeps score and racks up again.
 *
 * The one thing it does need is the table, because most of the questions the
 * rules ask ("has this player cleared their group?") are questions about what
 * is still on the cloth. It only ever reads it.
 */
var Rules = (function () {
    'use strict';

    /**
     * Rules that are not in the rulebook everyone shares.
     *
     * Eight ball has one codified set and a great many pub variants, and the
     * ones worth having are the ones somebody actually plays by. They live
     * here, off by default, so the game is the standard one until it is asked
     * not to be.
     */
    var options = {
        // Two separate house rules, not one either-or, and each is its own
        // game. The bank rule is about where the 8 goes: it has to come off a
        // cushion on the way in, so sinking it straight loses. The kick rule
        // is about how you may address it: you may not aim at it directly, so
        // the cue ball has to come off a cushion before it touches it. Both at
        // once is legal, and needs a cushion at each end.
        blackBank: false,
        blackKick: false
    };

    /** Which half of the rack a ball belongs to; the cue ball and 8 are neither. */
    function groupOf(id) {
        if (id === 0 || id === 8) return null;
        return id < 8 ? 'solids' : 'stripes';
    }

    function other(group) {
        return group === 'solids' ? 'stripes' : 'solids';
    }

    /** How many of a group are still on the table. */
    function remaining(world, group) {
        var left = 0;
        world.balls.forEach(function (b) {
            if (b.active && groupOf(b.id) === group) left++;
        });
        return left;
    }

    /**
     * What this player has to hit first.
     * @return {?string} 'solids', 'stripes', 'eight', or null while the table
     *     is open and anything but the 8 will do
     */
    function legalTarget(world, groups, player) {
        var group = groups[player];
        if (!group) return null;
        return remaining(world, group) === 0 ? 'eight' : group;
    }

    /** The balls this player is allowed to hit first, for a shot picker. */
    function legalBalls(world, groups, player) {
        var target = legalTarget(world, groups, player);
        return world.balls.filter(function (b) {
            if (!b.active || b.id === 0) return false;
            if (target === 'eight') return b.id === 8;
            if (target) return groupOf(b.id) === target;
            return b.id !== 8;            // open table: anything but the 8
        });
    }

    /**
     * Everything a shot is judged on, gathered as it happens.
     *
     * `target` has to be read *before* the shot: by the time it is judged, the
     * ball it was aimed at may already be off the table and the answer would
     * have changed.
     */
    function newShot(world, groups, player, broken) {
        return {
            first: null,              // id of the first ball the cue ball touched
            potted: [],               // everything that dropped, cue ball included
            rail: false,              // did anything reach a cushion after contact
            cueRailFirst: false,      // cue ball off a cushion before it touched anything
            eightRail: false,         // the 8 off a cushion at any point
            breakShot: !broken,
            target: legalTarget(world, groups, player)
        };
    }

    /** Fold one step's worth of physics events into the shot record. */
    function track(shot, events) {
        events.forEach(function (e) {
            if (e.type === 'ballHit') {
                if (shot.first === null && (e.a.id === 0 || e.b.id === 0)) {
                    shot.first = (e.a.id === 0 ? e.b.id : e.a.id);
                }
            } else if (e.type === 'cushion') {
                if (shot.first !== null) shot.rail = true;
                // Nothing but the cue ball is moving before the first contact,
                // so a cushion before then is the cue ball's by definition.
                else shot.cueRailFirst = true;
                if (e.ball && e.ball.id === 8) shot.eightRail = true;
            } else if (e.type === 'pot') {
                shot.potted.push(e.ball.id);
            }
        });
        return shot;
    }

    /**
     * Judge a finished shot.
     *
     * Call it once the table is at rest, with the world in the state the shot
     * left it: the questions about who has cleared what are asked of the cloth
     * as it is now, not as it was.
     *
     * @param {Object} world   the table, read only
     * @param {Object} pos     {groups: [g, g], player, open}
     * @param {Object} shot    from newShot/track
     * @return {Object} what happened, for the caller to apply
     */
    function resolve(world, pos, shot) {
        var player = pos.player;
        var potted = shot.potted;
        var scratch = potted.indexOf(0) >= 0;
        var eight = potted.indexOf(8) >= 0;
        var objects = potted.filter(function (id) { return id !== 0 && id !== 8; });
        var target = shot.target;

        var out = {
            foul: null,
            potted: objects,
            scratch: scratch,
            respotEight: false,
            groups: null,              // {0: g, 1: g} once the table closes
            open: pos.open,
            gameOver: null,            // {winner, why}
            player: player,
            ballInHand: false,
            kitchenOnly: false,
            message: ''
        };

        if (shot.first === null) {
            out.foul = 'No contact with any ball.';
        } else if (target === 'eight' && shot.first !== 8) {
            out.foul = 'You are on the 8 ball and hit the ' + shot.first + ' first.';
        } else if (target && target !== 'eight' && groupOf(shot.first) !== target) {
            out.foul = 'Wrong ball first: you are on ' + target + '.';
        } else if (!target && shot.first === 8 && !shot.breakShot) {
            out.foul = 'The table is open but the 8 ball is never a legal first hit.';
        }

        if (!out.foul && potted.length === 0 && !shot.rail) {
            out.foul = 'No ball potted and nothing reached a cushion.';
        }

        // The house rules on the black, off unless asked for. The kick rule
        // judges the shot whether or not the 8 drops, because it is about how
        // you were allowed to address it; the bank rule only bites when the 8
        // actually goes in, because it is about where it went.
        if (!out.foul && options.blackKick && target === 'eight' &&
                shot.first === 8 && !shot.cueRailFirst) {
            out.foul = 'House rule: the cue ball has to come off a cushion ' +
                'before it touches the 8.';
        }
        if (!out.foul && options.blackBank && target === 'eight' &&
                eight && !shot.eightRail) {
            out.foul = 'House rule: the 8 has to come off a cushion before it drops.';
        }
        if (scratch) out.foul = out.foul || 'Scratch - the cue ball went down.';

        // the 8 ball on the break is nobody's fault: it gets spotted and play
        // carries on, so from here it counts as never having dropped
        if (eight && shot.breakShot) {
            out.respotEight = true;
            eight = false;
        }

        // otherwise the 8 ball ends the game one way or the other
        if (eight) {
            var cleared = pos.groups[player] && remaining(world, pos.groups[player]) === 0;
            out.gameOver = (cleared && !out.foul && !scratch)
                ? {winner: player, why: 'potted the 8 ball to win'}
                : {winner: 1 - player, why: 'wins: the 8 ball went down early'};
            // The foul is why they lost, and the game over line was throwing
            // it away - so the one shot that ends a game was the one shot that
            // did not say what was wrong with it.
            out.message = 'Player ' + (out.gameOver.winner + 1) + ' ' +
                out.gameOver.why + '.' + (out.foul ? ' ' + out.foul : '') +
                ' Press R for a new rack.';
            return out;
        }

        // the first legal pot after the break decides who owns which half
        if (pos.open && !out.foul && objects.length && !shot.breakShot) {
            var mineNow = groupOf(objects[0]);
            out.groups = {};
            out.groups[player] = mineNow;
            out.groups[1 - player] = other(mineNow);
            out.open = false;
        }

        var owned = out.groups ? out.groups[player] : pos.groups[player];
        var mine = objects.filter(function (id) {
            return !owned || groupOf(id) === owned;
        });

        if (out.foul) {
            out.player = 1 - player;
            out.ballInHand = true;
            // after a bad break the incoming player is still stuck behind the line
            out.kitchenOnly = !!shot.breakShot;
            out.message = out.foul + ' Ball in hand for player ' + (out.player + 1) + '.';
        } else if (mine.length) {
            out.message = 'Potted ' + mine.join(', ') + '. Same player again.';
        } else {
            out.player = 1 - player;
            out.message = objects.length
                ? 'Potted your opponent’s ball. Turn passes.'
                : 'Nothing dropped. Player ' + (out.player + 1) + ' to shoot.';
        }

        return out;
    }

    /**
     * May the cue ball be put down here? Clear of the rails, not on top of a
     * ball already on the cloth, and behind the head string when the ball in
     * hand came from a foul on the break.
     */
    function placementLegal(world, x, y, kitchenOnly) {
        var r = world.radius, W = world.width, H = world.height;
        if (x < r * 1.2 || x > W - r * 1.2 || y < r * 1.2 || y > H - r * 1.2) return false;
        if (kitchenOnly && x > W * 0.25) return false;

        for (var i = 0; i < world.balls.length; i++) {
            var b = world.balls[i];
            if (!b.active || b.id === 0) continue;
            var dx = b.x - x, dy = b.y - y;
            if (dx * dx + dy * dy < (2.05 * r) * (2.05 * r)) return false;
        }
        return true;
    }

    /**
     * Put the 8 ball back on the foot spot, or as close behind it as there is
     * room for. Not part of judging a shot, but it is the rules' business where
     * a spotted ball goes.
     */
    function respot(world, ball) {
        var r = world.radius, W = world.width, H = world.height;
        for (var x = W * 0.75; x < W - 2 * r; x += r * 0.5) {
            var clear = world.balls.every(function (b) {
                return !b.active || b === ball ||
                    Math.hypot(b.x - x, b.y - H / 2) > 2.05 * r;
            });
            if (clear) {
                ball.placeAt(x, H / 2);
                return;
            }
        }
        ball.placeAt(W * 0.75, H / 2);
    }

    return {
        options: options,
        groupOf: groupOf,
        remaining: remaining,
        legalTarget: legalTarget,
        legalBalls: legalBalls,
        newShot: newShot,
        track: track,
        resolve: resolve,
        placementLegal: placementLegal,
        respot: respot
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Rules;
