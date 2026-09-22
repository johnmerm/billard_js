#!/usr/bin/env node
/**
 * train/selfplay.js - play the bots against each other and say what happened.
 *
 *   node train/selfplay.js --games 20
 *   node train/selfplay.js --games 20 --a search4 --b greedy
 *   node train/selfplay.js --games 4 --verbose
 *
 * Both sides play the same racks - seat A on the odd games and seat B on the
 * even ones - so a win rate means something after twenty games rather than two
 * hundred. This is also the loop a trainer will run: everything it needs comes
 * out of playGame's log.
 */
var Match = require('./match.js');
var Bot = require('./bot.js');

function arg(name, fallback) {
    var i = process.argv.indexOf('--' + name);
    if (i < 0) return fallback;
    var next = process.argv[i + 1];
    return (next === undefined || next.slice(0, 2) === '--') ? true : next;
}

function player(spec, seed) {
    var m = /^search(\d+)$/.exec(spec || '');
    if (m) return Bot.create({search: +m[1], seed: seed, name: spec});
    return Bot.create({search: 0, seed: seed, name: 'greedy'});
}

var games = +arg('games', 20);
var verbose = !!arg('verbose', false);
var specA = arg('a', 'greedy'), specB = arg('b', 'greedy');
var seed0 = +arg('seed', 1);

var wins = [0, 0], draws = 0;
var shots = 0, fouls = [0, 0], pots = [0, 0], tableTime = 0;
var started = Date.now();

for (var g = 0; g < games; g++) {
    // the same rack is played from both seats, so the rack itself cannot
    // decide the match
    var rackSeed = seed0 + (g >> 1);
    var swap = (g & 1) === 1;
    var a = player(specA, seed0 * 7919 + g);
    var b = player(specB, seed0 * 104729 + g);

    var result = Match.playGame(swap ? [b, a] : [a, b], {seed: rackSeed});

    var aSeat = swap ? 1 : 0;
    if (result.winner === null) draws++;
    else wins[result.winner === aSeat ? 0 : 1]++;

    shots += result.shots;
    tableTime += result.seconds;
    fouls[0] += result.fouls[aSeat]; fouls[1] += result.fouls[1 - aSeat];
    pots[0] += result.pots[aSeat]; pots[1] += result.pots[1 - aSeat];

    if (verbose) {
        console.log('game ' + (g + 1) + ' (rack ' + rackSeed +
            (swap ? ', seats swapped' : '') + '): ' +
            (result.winner === null ? 'no result' :
                (result.winner === aSeat ? specA : specB) + ' wins') +
            ' - ' + result.why + ', ' + result.shots + ' shots');
        result.log.forEach(function (s, i) {
            console.log('    ' + String(i + 1).padStart(3) + ' P' + (s.player + 1) +
                ' first=' + s.first + ' potted=[' + s.potted + '] ' + s.message);
        });
    }
}

var wall = (Date.now() - started) / 1000;
console.log('');
console.log(specA + ' ' + wins[0] + ' - ' + wins[1] + ' ' + specB +
    (draws ? ' (' + draws + ' unfinished)' : ''));
console.log('  ' + (shots / games).toFixed(1) + ' shots per rack, ' +
    (pots[0] / games).toFixed(1) + ' / ' + (pots[1] / games).toFixed(1) + ' pots, ' +
    (fouls[0] / games).toFixed(1) + ' / ' + (fouls[1] / games).toFixed(1) + ' fouls');
console.log('  ' + wall.toFixed(1) + ' s for ' + games + ' racks (' +
    (wall / games).toFixed(2) + ' s each, ' + (shots / wall).toFixed(1) + ' shots/s), ' +
    (tableTime / shots).toFixed(1) + ' s of table per shot');
