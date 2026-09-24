/**
 * llm.js - a seat played by a language model.
 *
 * The page already knows how to describe a position (`brief.js`) and how to
 * take a numbered pot (`Billiards.play`). This is the piece between them: it
 * sends the brief to a model, reads a choice back, and plays it.
 *
 * The model is given a *menu*, not a table full of coordinates. `brief.js`
 * numbers every pot that is on, with its cut angle and the two distances, so
 * the answer is a choice between a handful of options plus how hard to hit it.
 * Asking for an aim angle instead would make the model redo trigonometry the
 * page has already done exactly, slowly and worse.
 *
 * The key belongs to whoever is playing, is typed in at runtime, and is never
 * committed. It does go into the page, which is why the page should be served
 * from localhost or opened from a file when a real key is in it: anything that
 * can put a script on this origin can read it.
 *
 * One provider today. `PROVIDERS` is the seam for the rest - each entry owns
 * its url, headers, request shape and where the answer and the token counts
 * are in the reply, and nothing outside it knows which one is in use.
 */
var LLM = (function () {
    'use strict';

    var TIMEOUT = 90000;         // a turn that has not answered by now never will
    var SPEND_CAP = 2.00;        // dollars, per page load: a game that plays

    /* ------------------------------------------------------------------ *
     * providers
     * ------------------------------------------------------------------ */

    /**
     * What the answer has to look like. Flat on purpose: a schema with one
     * shape per action would be more honest about the data and much more
     * awkward for a model to fill in, and the unused fields cost nothing.
     */
    var ANSWER = {
        type: 'object',
        properties: {
            reason: {type: 'string', description: 'One sentence: why this shot.'},
            action: {
                type: 'string', enum: ['pot', 'safety', 'place'],
                description: 'pot: take a numbered pot. safety: roll to a point. ' +
                    'place: put the cue ball down, when it is in hand.'
            },
            pot: {type: 'integer', description: 'Which pot, as the brief numbers them. 0 if not potting.'},
            x: {type: 'number', description: 'Target or placement, cm across. 0 if unused.'},
            y: {type: 'number', description: 'Target or placement, cm up. 0 if unused.'},
            power: {type: 'number', description: '0 for the softest roll, 1 for everything.'},
            side: {type: 'number', description: 'Left/right english, -1 to 1. 0 for none.'},
            vert: {type: 'number', description: 'Draw to follow, -1 to 1. 0 for none.'}
        },
        required: ['reason', 'action', 'pot', 'x', 'y', 'power', 'side', 'vert'],
        additionalProperties: false
    };

    var PROVIDERS = {
        claude: {
            label: 'Claude',
            model: 'claude-opus-5',
            priceIn: 5.00, priceOut: 25.00,           // dollars per million tokens
            url: 'https://api.anthropic.com/v1/messages',
            headers: function (key) {
                return {
                    'content-type': 'application/json',
                    'x-api-key': key,
                    'anthropic-version': '2023-06-01',
                    // The api will not answer a browser without this. It is named
                    // the way it is because a key in a page is readable by the
                    // page; see the note at the top of this file.
                    'anthropic-dangerous-direct-browser-access': 'true'
                };
            },
            body: function (cfg, system, prompt) {
                return {
                    model: cfg.model,
                    max_tokens: 4000,
                    system: system,
                    messages: [{role: 'user', content: prompt}],
                    output_config: {
                        effort: cfg.effort || 'medium',
                        format: {type: 'json_schema', schema: ANSWER}
                    }
                };
            },
            answer: function (data) {
                if (data.stop_reason === 'refusal') return null;
                var text = '';
                (data.content || []).forEach(function (b) {
                    if (b.type === 'text') text += b.text;
                });
                return text;
            },
            // input_tokens is what was not cached; the other two are billed at
            // their own multiples, so they are counted separately rather than
            // folded in and quietly overcharged.
            usage: function (data) {
                var u = data.usage || {};
                return {
                    inp: (u.input_tokens || 0) +
                        (u.cache_creation_input_tokens || 0) * 1.25 +
                        (u.cache_read_input_tokens || 0) * 0.1,
                    out: u.output_tokens || 0
                };
            }
        }
    };

    /* ------------------------------------------------------------------ *
     * what the model is told
     * ------------------------------------------------------------------ */

    var SYSTEM =
        'You are playing eight ball. You will be given the table in words and a ' +
        'numbered list of the pots that are on, and you answer with one shot.\n\n' +
        'Positions are centimetres on a 224 x 112 table with the origin at a corner. ' +
        'power runs 0 to 1. side is left/right english and vert is draw (negative) ' +
        'to follow (positive), both -1 to 1.\n\n' +
        'What the pot list does not tell you is where the cue ball finishes, and ' +
        'that is how turns are actually lost. Measured over ~500 shots each, always ' +
        'taking the first pot: at power 0.8 it scratches 16% of the time, at 0.55 ' +
        '12%, at 0.3 12%, and at 0.3 with vert -0.5 only 7% - which also pots the ' +
        'most. Most shots want less power than they look like they want: the ball ' +
        'only has to reach the pocket, not arrive hard. Spin does not rescue a shot ' +
        'that is already too hard.\n\n' +
        'Those are habits, not rules. You can see the position and they cannot. ' +
        'Think about where the cue ball goes after contact and whether a pocket is ' +
        'waiting there, and where it leaves you for the next one.\n\n' +
        'Answer with action "pot" and a pot number from the list; or "safety" with ' +
        'a point to roll to, when nothing is on or nothing is worth taking; or ' +
        '"place" with where to put the cue ball, when the brief says it is in hand. ' +
        'Keep reason to one sentence - it is shown to somebody watching the game.';

    /* ------------------------------------------------------------------ *
     * per seat state
     * ------------------------------------------------------------------ */

    var seats = [null, null];          // config per player, null when not an llm
    var spent = 0;                     // dollars this page load
    var inFlight = [false, false];
    var log = null;                    // the transcript window

    function name(player) {
        var cfg = seats[player];
        return cfg ? (PROVIDERS[cfg.provider].label + ' ' + cfg.model) : null;
    }

    function cost() {
        return spent;
    }

    /* ------------------------------------------------------------------ *
     * the transcript
     * ------------------------------------------------------------------ */

    /**
     * A window of its own, opened from the click that set the seat up: a popup
     * asked for later, off the back of an api reply, is one the browser blocks.
     */
    function openLog() {
        if (log && !log.closed) return log;
        log = window.open('', 'billiards-llm', 'width=560,height=760');
        if (!log) return null;
        log.document.write(
            '<!doctype html><meta charset="utf-8"><title>Billiards — what the players said</title>' +
            '<style>body{margin:0;padding:14px;background:#12161c;color:#dfe6ef;' +
            'font:12px/1.55 ui-monospace,Menlo,Consolas,monospace}' +
            'h2{margin:18px 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;' +
            'color:#7fd0ff;border-top:1px solid #253040;padding-top:12px}' +
            'h2.p2{color:#c496ff}pre{margin:0 0 8px;white-space:pre-wrap;word-break:break-word}' +
            '.said{color:#ffe2b0;margin:0 0 8px}.meta{color:#6f7f93}' +
            '.err{color:#ff9d9d}#cost{position:sticky;top:0;background:#12161c;' +
            'padding:6px 0;border-bottom:1px solid #253040;color:#9fb0c6}</style>' +
            '<div id="cost">no spend yet</div><div id="feed"></div>');
        log.document.close();
        return log;
    }

    function say(player, cls, html) {
        if (!log || log.closed) return;
        var feed = log.document.getElementById('feed');
        if (!feed) return;
        var block = log.document.createElement('div');
        block.innerHTML = '<h2 class="p' + (player + 1) + '">Player ' + (player + 1) +
            ' — ' + (name(player) || 'llm') + '</h2>' +
            '<div class="' + cls + '">' + html + '</div>';
        feed.appendChild(block);
        log.scrollTo(0, log.document.body.scrollHeight);

        var meter = log.document.getElementById('cost');
        if (meter) meter.textContent = 'spent so far: $' + spent.toFixed(4) +
            ' of the $' + SPEND_CAP.toFixed(2) + ' cap';
    }

    function escape(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    }

    /* ------------------------------------------------------------------ *
     * setting a seat up
     * ------------------------------------------------------------------ */

    /**
     * Ask for a key and a model. A prompt box rather than a modal for now: the
     * modal, with the storage choice and the running cost in it, is its own
     * piece of work, and nothing here needs to change when it arrives.
     */
    function configure(player, done) {
        var key = seats[player] && seats[player].key;
        if (!key) {
            // Reuse the other seat's key rather than asking twice for the same one.
            var other = seats[1 - player];
            key = other && other.key;
        }
        if (!key) {
            key = window.prompt('Anthropic API key for player ' + (player + 1) +
                '.\n\nIt stays in this tab, is never stored and never leaves here ' +
                'except to api.anthropic.com. Serve this page from localhost or ' +
                'open it from a file when you use a real key.');
            if (!key) { done(false); return; }
        }

        var model = window.prompt('Model for player ' + (player + 1) + ':',
            (seats[player] && seats[player].model) || PROVIDERS.claude.model);
        if (!model) { done(false); return; }
        model = model.trim();

        // Two prompt boxes in a row is two chances to paste the wrong thing
        // into the wrong one, and a key in the model field comes back as an
        // api error about an unknown model, which says nothing useful.
        if (/^sk-/.test(model)) {
            window.alert('That looks like an api key rather than a model name.');
            done(false);
            return;
        }

        seats[player] = {
            provider: 'claude',
            model: model,
            key: key.trim(),
            effort: 'medium',
            priceIn: PROVIDERS.claude.priceIn,
            priceOut: PROVIDERS.claude.priceOut
        };
        openLog();
        done(true);
    }

    function release(player) {
        seats[player] = null;
        inFlight[player] = false;
    }

    /* ------------------------------------------------------------------ *
     * a turn
     * ------------------------------------------------------------------ */

    function parse(text) {
        if (!text) return null;
        try { return JSON.parse(text); } catch (e) { /* not bare json */ }
        // A model that wrapped it in prose or a fence still meant the object.
        var m = text.match(/\{[\s\S]*\}/);
        if (!m) return null;
        try { return JSON.parse(m[0]); } catch (e) { return null; }
    }

    /**
     * Ask the model for this seat's move.
     *
     * @param {string} brief   the position, as brief.js writes it
     * @param {number} player
     * @return {Promise<?Object>} the parsed answer, or null if it could not play
     */
    function think(player, brief) {
        var cfg = seats[player];
        if (!cfg) return Promise.resolve(null);
        if (spent >= SPEND_CAP) {
            say(player, 'err', 'Stopped: $' + spent.toFixed(2) + ' spent, which is the cap.');
            return Promise.resolve(null);
        }
        if (inFlight[player]) return Promise.resolve(null);
        inFlight[player] = true;

        var provider = PROVIDERS[cfg.provider];
        say(player, 'meta', '<pre>' + escape(brief) + '</pre>');

        var stop = new AbortController();
        var timer = window.setTimeout(function () { stop.abort(); }, TIMEOUT);

        return window.fetch(provider.url, {
            method: 'POST',
            headers: provider.headers(cfg.key),
            body: JSON.stringify(provider.body(cfg, SYSTEM, brief)),
            signal: stop.signal
        }).then(function (res) {
            return res.json().then(function (data) {
                if (!res.ok) {
                    throw new Error((data.error && data.error.message) ||
                        ('the api answered ' + res.status));
                }
                return data;
            });
        }).then(function (data) {
            var u = provider.usage(data);
            spent += (u.inp * cfg.priceIn + u.out * cfg.priceOut) / 1e6;

            var answer = parse(provider.answer(data));
            if (!answer) {
                say(player, 'err', 'No usable answer came back.');
                return null;
            }
            say(player, 'said', escape(answer.reason || '') +
                ' <span class="meta">[' + escape(answer.action) +
                (answer.action === 'pot' ? ' ' + answer.pot : '') +
                ' power ' + answer.power + ' vert ' + answer.vert +
                ' — ' + Math.round(u.inp) + ' in, ' + u.out + ' out]</span>');
            return answer;
        }).catch(function (err) {
            say(player, 'err', escape(err.name === 'AbortError'
                ? 'Gave up waiting after ' + (TIMEOUT / 1000) + 's.'
                : err.message));
            return null;
        }).then(function (answer) {
            window.clearTimeout(timer);
            inFlight[player] = false;
            return answer;
        });
    }

    function busy(player) {
        return inFlight[player];
    }

    return {
        configure: configure, release: release, name: name, think: think,
        busy: busy, cost: cost, openLog: openLog, cap: SPEND_CAP
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LLM;
