/**
 * brief.js - the table written out, for a player that reads instead of looks.
 *
 * An agent driving the page through a shell cannot see the cloth, and a picture
 * of it would not help much anyway: a cut angle matters to about a degree, and
 * nobody recovers that from pixels. What it needs is what the page already
 * knows exactly.
 *
 * The important choice here is that this is a *menu*, not a dump. Handing over
 * sixteen coordinates and asking for an aim angle makes the reader do the
 * trigonometry, which it will do slowly and badly, when `geometry.js` has
 * already done it exactly and for free. So the pots come out numbered, with the
 * cut angle and the two distances that decide how hard to hit them, and the
 * answer is a choice between them.
 *
 * The pots that are *not* on matter nearly as much, so they are listed too,
 * with the ball that is in the way. Without that the reader cannot tell a table
 * where it is snookered from one where it simply has nothing straight, and
 * those call for opposite shots.
 *
 * Nothing here decides anything or touches the table: world in, prose out.
 */
/*
 * Loaded twice over: by node with `require`, and by the page as a plain script
 * where the modules it needs are already globals.
 */
var Rules = typeof Rules !== 'undefined' ? Rules : require('./rules.js');
var Geometry = typeof Geometry !== 'undefined' ? Geometry : require('./train/geometry.js');

var Brief = (function () {
    'use strict';

    // the limit Geometry.candidates applies by default: past this the pot is a
    // theoretical line rather than a shot
    var MAX_CUT = 75 * Math.PI / 180;

    // enough to show what the trouble is without burying the pots that are on
    var MAX_BLOCKED = 6;

    function cm(m) { return Math.round(m * 100); }
    function deg(rad) { return Math.round(rad * 180 / Math.PI); }
    function at(o) { return cm(o.x) + ',' + cm(o.y); }
    function pocketName(p) { return '(' + at(p) + ')'; }

    function name(ball) { return ball.id === 0 ? 'cue' : String(ball.id); }

    function byId(a, b) { return a.id - b.id; }

    function onTable(world, group) {
        return world.balls.filter(function (b) {
            return b.active && Rules.groupOf(b.id) === group;
        }).sort(byId);
    }

    function listing(balls) {
        if (!balls.length) return 'all down';
        return balls.map(function (b) { return b.id + ': ' + at(b); }).join('   ');
    }

    function pad(s, n) {
        s = String(s);
        while (s.length < n) s += ' ';
        return s;
    }

    /* ------------------------------------------------------------------ *
     * the sections
     * ------------------------------------------------------------------ */

    function situation(world, pos, mine, theirs, lines) {
        if (pos.open) {
            lines.push('The table is open: you are neither solids nor stripes ' +
                'yet, and the ball you pot decides it. Anything but the 8 is a ' +
                'legal first contact.');
            return;
        }

        var left = Rules.remaining(world, mine);
        if (left === 0) {
            var house = [];
            if (Rules.options.blackBank) {
                house.push('the 8 has to come off a cushion before it drops');
            }
            if (Rules.options.blackKick) {
                house.push('the cue ball has to come off a cushion before it ' +
                    'touches the 8');
            }
            lines.push('You are ' + mine.toUpperCase() + ' and they are all ' +
                'down: the 8 wins it, into any pocket. Hit the 8 first or it ' +
                'is a foul.' + (house.length
                    ? ' House rule: ' + house.join(', and ') +
                      ' \u2014 the pots below already allow for it.'
                    : ''));
        } else {
            lines.push('You are ' + mine.toUpperCase() + ', ' + left + ' left. ' +
                'Hit one of yours first or it is a foul.');
        }
        var thoseLeft = Rules.remaining(world, theirs);
        lines.push('Opponent is ' + theirs.toUpperCase() + ', ' +
            (thoseLeft === 0 ? 'all down and on the 8.' : thoseLeft + ' left.'));
    }

    function table(world, lines) {
        var W = cm(world.width), H = cm(world.height);
        lines.push('Table ' + W + ' x ' + H + ' cm, origin at a corner, all ' +
            'positions in cm.');
        lines.push('Pockets: ' + world.pockets.map(pocketName).join(' ') +
            ' - the two at x=' + cm(world.width / 2) + ' are side pockets, ' +
            'narrower than the corners.');
    }

    function balls(world, pos, mine, theirs, lines) {
        var cue = world.ball(0);
        lines.push('');
        lines.push('On the table:');
        if (cue.active && !pos.ballInHand) lines.push('  cue      ' + at(cue));
        if (pos.open) {
            lines.push('  solids   ' + listing(onTable(world, 'solids')));
            lines.push('  stripes  ' + listing(onTable(world, 'stripes')));
        } else {
            lines.push('  yours    ' + listing(onTable(world, mine)));
            lines.push('  theirs   ' + listing(onTable(world, theirs)));
        }
        var eight = world.ball(8);
        if (eight && eight.active) lines.push('  eight    8: ' + at(eight));
    }

    /**
     * Why a pot that geometry rejected is not on. Re-walks the two paths a
     * candidate has to survive and reports the first thing that stopped it, in
     * the order the shot itself would meet them.
     *
     * @return {?Object} {kind, text, cut}, or null if the pot is on after all.
     *     `kind` is 'reach' when the pocket is simply behind the ball from here
     *     - true of most pockets most of the time, and not worth reporting.
     */
    function why(world, cue, ball, pocket) {
        var g = Geometry.ghost(world, cue, ball, pocket);
        if (!g) {
            return {kind: 'reach', cut: Infinity,
                text: 'the cue ball is on the wrong side of it'};
        }

        function no(kind, text) {
            return {kind: kind, cut: g.cut, text: text};
        }

        if (g.cut > MAX_CUT) return no('thin', 'cut ' + deg(g.cut) + 'deg, too thin');

        var b = Geometry.blocker(world, cue.x, cue.y, g.x, g.y, [cue, ball]);
        if (b) return no('blocked', name(b) + ' blocks the cue ball');

        b = Geometry.blocker(world, ball.x, ball.y, pocket.x, pocket.y, [cue, ball]);
        if (b) return no('blocked', name(b) + ' guards the pocket');

        return null;                  // this one is on, and is in the pot list
    }

    function pots(world, pos, lines) {
        var cue = world.ball(0);
        var legal = Rules.legalBalls(world, pos.groups, pos.player);
        var on = Geometry.shortlist(world, legal,
            Rules.demands(world, pos.groups, pos.player));

        lines.push('');
        if (!on.length) {
            lines.push('No pot is on. Play safe: leave them nothing and give ' +
                'the table back.');
        } else {
            lines.push('Your pots, straightest first:');
            on.forEach(function (c, i) {
                var how = c.kind === 'bank'
                    ? '  off the cushion at ' + at(c.via)
                    : c.kind === 'kick' ? '  via the cushion at ' + at(c.via) : '';
                lines.push('  [' + (i + 1) + '] ' + pad(c.ball.id, 2) + ' into ' +
                    pad(pocketName(c.pocket), 11) +
                    '  cut ' + pad(deg(c.cut) + 'deg', 6) +
                    '  cue->ball ' + pad(cm(c.distance), 4) +
                    '  ball->pocket ' + cm(c.toPocket) + how);
            });
        }

        // The pots that are not on, nearest miss first. A pocket the cue ball
        // simply cannot reach round to is left out: that is true of most of
        // them most of the time, and saying so buries the two or three
        // rejections that are actually telling the reader something.
        var missed = [];
        legal.forEach(function (ball) {
            world.pockets.forEach(function (p) {
                var no = why(world, cue, ball, p);
                if (!no || no.kind === 'reach') return;
                missed.push({
                    cut: no.cut,
                    text: ball.id + ' into ' + pocketName(p) + ' - ' + no.text
                });
            });
        });
        missed.sort(function (a, b) { return a.cut - b.cut; });

        if (missed.length) {
            lines.push('Not on: ' + missed.slice(0, MAX_BLOCKED).map(function (m) {
                return m.text;
            }).join('; ') + (missed.length > MAX_BLOCKED ? '; ...' : ''));
        }
    }

    function inHand(world, pos, lines) {
        var W = cm(world.width), H = cm(world.height);
        var margin = Math.ceil(cm(world.radius * 1.2));
        lines.push('');
        lines.push('Cue ball in hand: place it before you can be shown a shot.');
        lines.push('Legal anywhere from ' + margin + ' to ' + (W - margin) +
            ' across and ' + margin + ' to ' + (H - margin) + ' up' +
            (pos.kitchenOnly ? ', and behind the head string: x at most ' +
                cm(world.width * 0.25) + '.' : '.') +
            ' Not touching another ball.');
    }

    /* ------------------------------------------------------------------ *
     * the brief
     * ------------------------------------------------------------------ */

    /**
     * The whole position, for whoever is about to play it.
     *
     * @param {Object} world  the table
     * @param {Object} pos    {player, groups, open, broken, ballInHand, kitchenOnly}
     * @return {string}
     */
    function describe(world, pos) {
        var mine = pos.groups[pos.player];
        var theirs = mine ? (mine === 'solids' ? 'stripes' : 'solids') : null;
        var lines = [];

        lines.push('Player ' + (pos.player + 1) + ' to play.');
        situation(world, pos, mine, theirs, lines);
        table(world, lines);
        balls(world, pos, mine, theirs, lines);

        if (pos.ballInHand) inHand(world, pos, lines);
        else pots(world, pos, lines);

        return lines.join('\n');
    }

    return {describe: describe, why: why};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Brief;
