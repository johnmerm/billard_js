/**
 * ai.js - the trained player, on the page.
 *
 * The same code that plays it headless plays it here: geometry.js finds the
 * pots, match.js plays each one out in the physics, encode.js describes what it
 * leaves behind and the network says how much it likes that. Nothing about the
 * player is reimplemented for the browser; this file is only the plumbing.
 *
 * Two things the trainer never had to worry about:
 *
 *   loading      tensorflow is a megabyte and a half, and most people never
 *                switch the opponent on, so it is fetched the first time it is
 *                wanted and never otherwise.
 *   not freezing thinking about a turn means simulating a couple of dozen
 *                shots, which is most of a second of solid arithmetic. Doing it
 *                in one go would lock the page up and stop the table drawing,
 *                so the search hands back something steppable and this spends a
 *                few milliseconds of each frame on it.
 */
var AI = (function () {
    'use strict';

    var MODEL = 'model/value/model.json';
    var TF = 'lib/tfjs.js';

    var model = null;
    var loading = null;
    var thinking = null;          // the turn being worked on, if any

    /** Pull in a classic script and resolve once it has run. */
    function script(src) {
        return new Promise(function (resolve, reject) {
            var el = document.createElement('script');
            el.src = src;
            el.onload = resolve;
            el.onerror = function () { reject(new Error('could not load ' + src)); };
            document.head.appendChild(el);
        });
    }

    /**
     * Fetch tensorflow and the model, once. Resolves to the model, or rejects
     * with something worth showing a person.
     */
    function load(base) {
        if (model) return Promise.resolve(model);
        if (loading) return loading;

        base = base || '';
        loading = (typeof window.tf !== 'undefined'
            ? Promise.resolve()
            : script(base + TF))
            .then(function () {
                return window.tf.loadLayersModel(base + MODEL);
            })
            .then(function (loaded) {
                model = loaded;
                return model;
            })
            .catch(function (err) {
                loading = null;              // let it be tried again
                throw err;
            });
        return loading;
    }

    function ready() {
        return !!model;
    }

    /**
     * Start thinking about a turn. Nothing is computed yet - `tick` does the
     * work, a shot at a time, so the table goes on drawing while it thinks.
     *
     * @param {Object} world  the live table. Trial shots really are played on
     *     it and put back, so nothing may read it between a tick and a poll.
     * @param {Object} pos    {groups, player, open, broken, ballInHand, kitchenOnly}
     */
    function think(world, pos) {
        if (!model) return null;

        var player = Player.create({
            model: model, seed: Date.now() & 0xffff,
            shots: 3, spread: 2, noise: 0.004
        });

        thinking = {
            world: world, pos: pos, player: player,
            started: Date.now(), answer: null, failed: null,
            search: null
        };

        try {
            if (pos.ballInHand) {
                // placing costs no simulation at all, only a look at each spot,
                // so there is nothing to spread over frames
                thinking.answer = {place: player.place(world, pos)};
            } else {
                thinking.search = player.plan(world, pos);
            }
        } catch (err) {
            thinking.failed = err;
        }
        return thinking;
    }

    /**
     * Spend a slice of this frame thinking.
     *
     * @param {number} [budget]  milliseconds to use before handing the frame
     *     back. A frame is about 16, so single figures leaves the table drawing
     *     smoothly and still gets through a turn inside a second.
     */
    function tick(budget) {
        if (!thinking || thinking.answer || thinking.failed || !thinking.search) return;

        var until = Date.now() + (budget || 6);
        try {
            do {
                if (!thinking.search.step()) break;
            } while (Date.now() < until);

            if (thinking.search.done()) {
                thinking.answer = {shot: thinking.search.result()};
            }
        } catch (err) {
            thinking.failed = err;
            if (window.console) window.console.error('ai: ' + err.message, err);
        }
    }

    /** How far through the turn it is, 0 to 1, for something to show. */
    function progress() {
        if (!thinking) return 1;
        if (thinking.answer || thinking.failed) return 1;
        if (!thinking.search || !thinking.search.total) return 1;
        return thinking.search.played / thinking.search.total;
    }

    /** The answer, once there is one, and then forget the turn. */
    function poll() {
        if (!thinking) return null;
        if (thinking.failed) {
            var failed = {failed: thinking.failed};
            thinking = null;
            return failed;
        }
        if (!thinking.answer) return null;

        var answer = thinking.answer;
        answer.seconds = (Date.now() - thinking.started) / 1000;
        thinking = null;
        return answer;
    }

    function busy() {
        return !!thinking;
    }

    function cancel() {
        thinking = null;
    }

    return {
        load: load, ready: ready, think: think, tick: tick,
        poll: poll, progress: progress, busy: busy, cancel: cancel
    };
})();
