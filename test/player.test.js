/**
 * Value player tests: node test/player.test.js
 *
 * These do not need a trained model - what they check is that the network is
 * being asked the right question and that the answer is what decides the shot.
 * A stub standing in for the model makes that exact: give it an opinion and the
 * player's choice has to follow it.
 *
 * The one thing that would be invisible without a test is the bookkeeping. The
 * player plays every shot it is considering on the real table and puts it back
 * afterwards, several dozen times a turn; if any of that leaked, games would
 * still look legal and the player would simply be wrong forever.
 */
var Phys = require('../phys.js');
var Rules = require('../rules.js');
var Match = require('../train/match.js');
var Bot = require('../train/bot.js');
var Encode = require('../train/encode.js');
var Player = require('../train/player.js');

var failures = 0;

function check(name, ok, detail) {
    if (ok) {
        console.log('  ok   ' + name);
    } else {
        failures++;
        console.log('  FAIL ' + name + (detail ? ' -> ' + detail : ''));
    }
}

function layout(w) {
    return w.balls.map(function (b) {
        return b.id + ':' + (b.active ? b.x.toFixed(12) + ',' + b.y.toFixed(12) : 'off');
    }).join('|') + '#' + w.cannon.bodies.length;
}

/**
 * A model the test can put words in the mouth of. `score` is handed one
 * position's features and says what the network would have said about it.
 */
function stub(score) {
    var asked = [];
    return {
        asked: asked,
        predict: function (input) {
            var flat = input.dataSync();
            var rows = flat.length / Encode.SIZE;
            var out = [];
            for (var i = 0; i < rows; i++) {
                var features = flat.slice(i * Encode.SIZE, (i + 1) * Encode.SIZE);
                asked.push(features);
                out.push(Math.max(-1, Math.min(1, score(features))));
            }
            return {dataSync: function () { return out; }};
        }
    };
}

var names = Encode.labels();
var SHOTS = names.indexOf('shots');
var IN_HAND = names.indexOf('cue.inHand');

function table(balls) {
    var w = Phys.createTable({width: Match.TABLE_W, height: Match.TABLE_H});
    balls.forEach(function (b) { w.add(new Phys.Ball(b[0], b[1], b[2])); });
    return w;
}

/* ------------------------------------------------------------------ */

console.log('it asks about the position, and it asks a lot');

var w = table([[0, 0.6, 0.45], [1, 1.1, 0.3], [2, 1.5, 0.75],
    [9, 1.8, 0.45], [10, 0.9, 0.9], [8, 1.3, 0.55]]);
var pos = {groups: ['solids', 'stripes'], player: 0, open: false, broken: true};

var flat = stub(function () { return 0; });
var before = layout(w);
var choice = Player.create({model: flat, seed: 1, shots: 3, spread: 2}).shoot(w, pos);

check('it offers a shot', !!choice && typeof choice.angle === 'number',
    JSON.stringify(choice));
check('it tried several', flat.asked.length >= 3, flat.asked.length + ' positions');
check('the table is exactly as it found it', layout(w) === before);
check('every question was a real encoding', flat.asked.every(function (f) {
    return f.length === Encode.SIZE &&
        Array.prototype.every.call(f, function (x) { return x >= 0 && x <= 1; });
}));

console.log('the answer is what decides');

// two models with opposite opinions about leaving the opponent shots on
var shy = Player.create({
    model: stub(function (f) { return f[SHOTS]; }),   // hates leaving pots on
    seed: 1, shots: 3, spread: 3
}).shoot(w, pos);
var generous = Player.create({
    model: stub(function (f) { return -f[SHOTS]; }),  // loves leaving pots on
    seed: 1, shots: 3, spread: 3
}).shoot(w, pos);

check('opposite opinions pick different shots',
    shy.angle !== generous.angle || shy.power !== generous.power ||
    shy.vert !== generous.vert,
    JSON.stringify(shy) + ' vs ' + JSON.stringify(generous));

console.log('winning beats any opinion');

// the 8 on its own, hanging over a pocket, with the player on it
var endgame = table([[0, 0.55, 0.30], [8, 0.28, 0.16]]);
var endPos = {groups: ['solids', 'stripes'], player: 0, open: false, broken: true};
check('the position really is on the 8',
    Rules.legalTarget(endgame, endPos.groups, 0) === 'eight');

var gloomy = Player.create({
    model: stub(function () { return 1; }),     // every position is wonderful
    seed: 2, shots: 3, spread: 3                 // for whoever plays next
});
var endShot = gloomy.shoot(endgame, endPos);
var snap = Bot.snapshot(endgame);
var played = Match.playShot(endgame, endPos, endShot);
Bot.restore(endgame, snap);
check('it takes the shot that ends the game',
    played.gameOver && played.gameOver.winner === 0,
    played.gameOver ? 'winner ' + played.gameOver.winner : 'no result: ' + played.message);

console.log('putting the cue ball down');

var handTable = table([[0, 0.6, 0.45], [1, 1.1, 0.3], [9, 1.8, 0.45], [8, 1.3, 0.55]]);
handTable.ball(0).lift();
var handPos = {groups: ['solids', 'stripes'], player: 0, open: false,
    broken: true, ballInHand: true, kitchenOnly: false};

var handStub = stub(function (f) { return f[SHOTS]; });      // likes having pots on
var handBefore = layout(handTable);
var spot = Player.create({model: handStub, seed: 3}).place(handTable, handPos);

check('it offers a legal spot',
    spot && Rules.placementLegal(handTable, spot.x, spot.y, false),
    JSON.stringify(spot));
check('it left the cue ball in hand', layout(handTable) === handBefore);
check('it judged the cue ball as placed, not as in hand',
    handStub.asked.length > 1 &&
    handStub.asked.every(function (f) { return f[IN_HAND] === 0; }));

var kitchen = Player.create({model: handStub, seed: 3}).place(handTable,
    {groups: handPos.groups, player: 0, open: false, broken: true,
        ballInHand: true, kitchenOnly: true});
check('and it respects the head string when it has to',
    kitchen && kitchen.x <= Match.TABLE_W * 0.25 + 1e-9, JSON.stringify(kitchen));

console.log('a whole rack against the baseline');

var thinker = Player.create({
    model: stub(function (f) { return f[SHOTS] * 0.5; }),
    seed: 9, shots: 2, spread: 1
});
var plain = Bot.create({search: 0, seed: 10});
var game = Match.playGame([thinker, plain], {seed: 5});

check('it plays a legal game to the end',
    game.winner === 0 || game.winner === 1, game.winner + ': ' + game.why);
check('and it did not simply forfeit',
    game.why !== 'no legal placement' && game.why !== 'no shot offered', game.why);
check('it potted something along the way', game.pots[0] > 0,
    game.pots.join('/'));

/* ------------------------------------------------------------------ */

console.log('');
if (failures) {
    console.log(failures + ' check(s) failed');
    process.exit(1);
}
console.log('all checks passed');
