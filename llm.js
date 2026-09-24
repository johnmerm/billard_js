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
    var DEFAULT_CAP = 2.00;      // dollars, per page load: a game that plays

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

    /**
     * An openai-compatible chat/completions provider. Four of the five speak
     * this shape, so they differ only in a url, a name and what they cost.
     *
     * Deliberately plain: no json mode, no response_format, nothing optional.
     * None of these could be reached from where this was written - see `cors`
     * below - and every field that is not strictly needed is one more way for
     * an untested request to come back a 400. `parse` reads json out of prose,
     * which is the part that makes that safe.
     */
    function openaiShape(label, url, cors, hint) {
        return {
            label: label, url: url, cors: cors, hint: hint,
            model: '', priceIn: 0, priceOut: 0,
            headers: function (key) {
                return {
                    'content-type': 'application/json',
                    'authorization': 'Bearer ' + key
                };
            },
            /**
             * `variant` exists for one reason: newer models on several of
             * these apis rejected `max_tokens` and want `max_completion_tokens`
             * instead, and which one a given model wants is not something a
             * page can know in advance. So it sends one, and swaps on the 400
             * that says so. See `paramProblem` below.
             */
            body: function (cfg, system, prompt, variant) {
                var out = {
                    model: cfg.model,
                    messages: [
                        {role: 'system', content: system},
                        {role: 'user', content: prompt}
                    ]
                };
                if (variant) out.max_completion_tokens = 4000;
                else out.max_tokens = 4000;
                return out;
            },
            answer: function (data) {
                var choice = (data.choices || [])[0];
                return choice && choice.message && choice.message.content;
            },
            usage: function (data) {
                var u = data.usage || {};
                return {inp: u.prompt_tokens || 0, out: u.completion_tokens || 0};
            }
        };
    }

    var PROVIDERS = {
        claude: {
            label: 'Claude',
            // The one provider whose browser support was checked rather than
            // assumed: a cors preflight against the live endpoint returns
            // allow-origin * and allows the four headers below.
            cors: 'checked',
            hint: 'Browser calls verified. The header below is what enables them.',
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
        },

        // Not one of these could be reached from where this was written: the
        // network there allows api.anthropic.com and nothing else, so every
        // preflight came back a proxy denial rather than an answer from the
        // provider. The request shapes are right; whether the provider lets a
        // browser make them at all is untested, and a page cannot find that
        // out politely - a refused preflight reaches javascript as nothing
        // more than "failed to fetch". `corsFailure` below says so in words.
        openai: openaiShape('OpenAI', 'https://api.openai.com/v1/chat/completions',
            'untested', 'Browser support untested from here. See the note below.'),
        grok: openaiShape('Grok', 'https://api.x.ai/v1/chat/completions',
            'untested', 'Browser support untested from here. See the note below.'),
        kimi: openaiShape('Kimi', 'https://api.moonshot.ai/v1/chat/completions',
            'untested', 'Browser support untested from here. See the note below.'),
        qwen: openaiShape('Qwen',
            'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
            'untested', 'Browser support untested from here. See the note below.')
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
    var cap = DEFAULT_CAP;             // dollars, raised or lowered in the dialog

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
            ' of the $' + cap.toFixed(2) + ' cap';
    }

    function escape(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    }

    /* ------------------------------------------------------------------ *
     * setting a seat up
     * ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ *
     * keeping a key
     *
     * Nothing a page can decrypt by itself is protected, because the key to
     * do it has to be in the page too. So there are three honest options and
     * no fourth: do not keep it, keep it under a passphrase that never is,
     * or keep it in the open and know that is what you did.
     *
     * The middle one is real against a real threat - a storage dump, a
     * backup, somebody else on the machine - and useless against a script
     * running here while you play. Both halves of that are worth saying.
     * ------------------------------------------------------------------ */

    var STORE = 'billiards.llm.key';

    /** WebCrypto is only there in a secure context: https, or localhost. */
    function canEncrypt() {
        return !!(window.crypto && window.crypto.subtle && window.isSecureContext);
    }

    function bytes(s) { return new TextEncoder().encode(s); }

    function b64(buf) {
        var out = '', view = new Uint8Array(buf);
        for (var i = 0; i < view.length; i++) out += String.fromCharCode(view[i]);
        return window.btoa(out);
    }

    function unb64(s) {
        var raw = window.atob(s), out = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
    }

    /** A key from a passphrase, stretched so guessing it is expensive. */
    function derive(pass, salt) {
        return window.crypto.subtle.importKey('raw', bytes(pass), 'PBKDF2', false,
            ['deriveKey']).then(function (base) {
            return window.crypto.subtle.deriveKey({
                name: 'PBKDF2', salt: salt, iterations: 310000, hash: 'SHA-256'
            }, base, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
        });
    }

    function keep(apiKey, how, pass) {
        if (how === 'none') {
            try { window.localStorage.removeItem(STORE); } catch (e) { /* denied */ }
            return Promise.resolve();
        }
        if (how === 'plain') {
            try {
                window.localStorage.setItem(STORE, JSON.stringify({plain: apiKey}));
            } catch (e) { /* private window, or storage off */ }
            return Promise.resolve();
        }

        var salt = window.crypto.getRandomValues(new Uint8Array(16));
        var iv = window.crypto.getRandomValues(new Uint8Array(12));
        return derive(pass, salt).then(function (k) {
            return window.crypto.subtle.encrypt({name: 'AES-GCM', iv: iv}, k, bytes(apiKey));
        }).then(function (sealed) {
            try {
                window.localStorage.setItem(STORE, JSON.stringify({
                    salt: b64(salt), iv: b64(iv), sealed: b64(sealed)
                }));
            } catch (e) { /* as above */ }
        });
    }

    function stored() {
        try { return JSON.parse(window.localStorage.getItem(STORE) || 'null'); }
        catch (e) { return null; }
    }

    /** Whatever is on disk, unsealed if it needs to be and can be. */
    function recall() {
        var held = stored();
        if (!held) return Promise.resolve(null);
        if (held.plain) return Promise.resolve(held.plain);
        if (!canEncrypt()) return Promise.resolve(null);

        var pass = window.prompt('Passphrase for the stored api key.\n\n' +
            'Cancel to type the key in instead.');
        if (!pass) return Promise.resolve(null);

        return derive(pass, unb64(held.salt)).then(function (k) {
            return window.crypto.subtle.decrypt(
                {name: 'AES-GCM', iv: unb64(held.iv)}, k, unb64(held.sealed));
        }).then(function (plain) {
            return new TextDecoder().decode(plain);
        }).catch(function () {
            window.alert('That passphrase does not open the stored key.');
            return null;
        });
    }

    /* ------------------------------------------------------------------ *
     * the dialog
     * ------------------------------------------------------------------ */

    function el(id) { return document.getElementById(id); }

    /**
     * Where this page came from, and what that means for a key typed into it.
     *
     * The question is never "is this host trustworthy" but "who can change
     * what runs here". A page served off a branch is whatever was last pushed
     * to that branch, so the answer is everyone who can push - and the page
     * arrives with your key already in it. The same url pinned to a commit
     * cannot change under you, which is the whole of the difference and costs
     * nothing but a longer link.
     */
    /**
     * Hosts that serve pages for everybody out of one origin.
     *
     * This is the part that catches people out: an origin is a scheme, a host
     * and a port, and the path is not in it. Every githack url is the same
     * origin as every other githack url, so a page in a stranger's repo shares
     * this one's localStorage and can read anything left in it by name - and
     * the name is in this repo, which is public.
     */
    var SHARED_HOSTS = [
        'raw.githack.com', 'rawcdn.githack.com', 'raw.githubusercontent.com',
        'cdn.jsdelivr.net', 'cdn.statically.io', 'gitcdn.link', 'htmlpreview.github.io'
    ];

    function sharedOrigin() {
        return SHARED_HOSTS.indexOf(window.location.hostname) >= 0;
    }

    function provenance() {
        if (window.location.protocol === 'file:') {
            return {warn: false, text: 'Opened from a file, which nobody else can ' +
                'change. Storing the key encrypted needs https or localhost, so ' +
                'that option is off here.'};
        }
        if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)) {
            return {warn: false, text: 'Served from your own machine, which is the ' +
                'safest place for a real key.'};
        }
        // Any path segment that is a git object id: the page is frozen.
        if (/\/[0-9a-f]{7,40}\//.test(window.location.pathname)) {
            return {warn: false, text: 'Pinned to a commit, so a later push cannot ' +
                'change this page under you. Your key stays between this page and ' +
                'the provider.'};
        }
        return {warn: true, text: 'This page is served from a branch, so it runs ' +
            'whatever was last pushed there \u2014 with your key in it. Pin the url ' +
            'to a commit id instead of a branch name to freeze it, and use a key ' +
            'with its own spend limit that you can revoke.'};
    }

    /** The storage warning, which on a shared origin is a different warning. */
    function storageNote() {
        if (!sharedOrigin()) {
            return 'Convenient. Readable by anything that can read this ' +
                'browser\u2019s storage for this origin.';
        }
        return window.location.hostname + ' serves everybody from one origin, so ' +
            'a page in a stranger\u2019s repo shares this storage and can read a ' +
            'plain key by name. Not offered here.';
    }

    /**
     * Ask which model plays this seat, and what to do with the key.
     *
     * Opening it is a click, which matters for more than politeness: the
     * transcript window is opened from here, and a popup asked for later - off
     * the back of an api reply - is one the browser refuses.
     */
    function configure(player, done) {
        var veil = el('llmveil');
        if (!veil) { done(false); return; }             // page without the dialog

        el('llmseat').textContent = String(player + 1);

        var choose = el('llmprovider');
        if (!choose.options.length) {
            Object.keys(PROVIDERS).forEach(function (id) {
                var opt = document.createElement('option');
                opt.value = id;
                opt.textContent = PROVIDERS[id].label;
                choose.appendChild(opt);
            });
        }

        var was = seats[player] || seats[1 - player] || {};
        choose.value = was.provider || 'claude';
        el('llmcap').value = String(cap);
        el('llmkey').value = was.key || '';

        var origin = el('llmorigin');
        origin.textContent = provenance().text;
        origin.className = provenance().warn ? 'warn' : '';

        // Same origin also means a page on this host can put this one in an
        // iframe and reach straight into it, so a key typed into a framed copy
        // is a key typed into whatever framed it.
        if (window.top !== window.self) {
            window.alert('This page is inside a frame. Open it in a window of its ' +
                'own before typing a key: on a shared origin, whatever framed it ' +
                'can read everything in here.');
            done(false);
            return;
        }

        var plain = document.querySelector('input[name="llmkeep"][value="plain"]');
        plain.disabled = sharedOrigin();
        plain.parentNode.querySelector('span').textContent = storageNote();
        if (plain.checked && plain.disabled) {
            document.querySelector('input[name="llmkeep"][value="none"]').checked = true;
        }

        var crypt = el('llmcrypt');
        crypt.disabled = !canEncrypt();
        el('llmcryptnote').textContent = canEncrypt()
            ? 'A passphrase you type once per session. Someone reading this ' +
              'browser\u2019s storage gets ciphertext, not the key.'
            : 'Needs https or localhost: a page opened from a file has no ' +
              'WebCrypto to encrypt with.';

        function refresh() {
            var p = PROVIDERS[choose.value];
            el('llmmodel').value = (was.provider === choose.value && was.model) || p.model;
            el('llmmodel').placeholder = p.model || 'model id, from your provider';
            el('llmin').value = (was.provider === choose.value && was.priceIn) || p.priceIn || '';
            el('llmout').value = (was.provider === choose.value && was.priceOut) || p.priceOut || '';
            var note = el('llmcors');
            note.textContent = p.hint;
            note.className = 'note' + (p.cors === 'checked' ? '' : ' warn');
        }
        choose.onchange = refresh;
        refresh();

        el('llmspend').textContent = spent > 0
            ? '$' + spent.toFixed(4) + ' spent so far' : '';

        function close() {
            veil.classList.remove('open');
            el('llmbox').onsubmit = null;
            el('llmcancel').onclick = null;
        }

        el('llmcancel').onclick = function () { close(); done(false); };

        el('llmbox').onsubmit = function (e) {
            e.preventDefault();
            var key = el('llmkey').value.trim();
            var model = el('llmmodel').value.trim();
            if (!key || !model) return;

            var how = 'none';
            var picked = document.querySelector('input[name="llmkeep"]:checked');
            if (picked) how = picked.value;

            var pass = null;
            if (how === 'crypt') {
                pass = window.prompt('A passphrase to seal the key with. ' +
                    'You will be asked for it once per session.');
                if (!pass) return;
            }

            cap = Number(el('llmcap').value) || cap;
            seats[player] = {
                provider: choose.value,
                model: model,
                key: key,
                effort: 'medium',
                priceIn: Number(el('llmin').value) || 0,
                priceOut: Number(el('llmout').value) || 0
            };

            keep(key, how, pass).then(function () {
                close();
                openLog();
                done(true);
            });
        };

        veil.classList.add('open');
        recall().then(function (held) {
            if (held && !el('llmkey').value) el('llmkey').value = held;
        });
        el('llmkey').focus();
    }

    function release(player) {
        seats[player] = null;
        inFlight[player] = false;
    }

    /* ------------------------------------------------------------------ *
     * a turn
     * ------------------------------------------------------------------ */

    /**
     * Is this the api telling us we named a parameter it does not take? Those
     * are worth one retry with the other name; everything else is not.
     */
    function paramProblem(message) {
        return /max_tokens|max_completion_tokens|[Uu]nsupported parameter/.test(message);
    }

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
        if (spent >= cap) {
            say(player, 'err', 'Stopped: $' + spent.toFixed(2) + ' spent, which is the cap.');
            return Promise.resolve(null);
        }
        if (inFlight[player]) return Promise.resolve(null);
        inFlight[player] = true;

        var provider = PROVIDERS[cfg.provider];
        say(player, 'meta', '<pre>' + escape(brief) + '</pre>');

        var stop = new AbortController();
        var timer = window.setTimeout(function () { stop.abort(); }, TIMEOUT);

        function send(variant) {
            return window.fetch(provider.url, {
                method: 'POST',
                headers: provider.headers(cfg.key),
                body: JSON.stringify(provider.body(cfg, SYSTEM, brief, variant)),
                signal: stop.signal
            }).then(function (res) {
                return res.json().then(function (data) {
                    if (!res.ok) {
                        var err = new Error((data.error && data.error.message) ||
                            ('the api answered ' + res.status));
                        err.status = res.status;
                        throw err;
                    }
                    return data;
                });
            });
        }

        return send(0).catch(function (err) {
            if (err.status !== 400 || !paramProblem(err.message)) throw err;
            say(player, 'meta', 'Retrying with max_completion_tokens: ' +
                escape(err.message));
            return send(1);
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
            say(player, 'err', escape(explain(err, provider)));
            return null;
        }).then(function (answer) {
            window.clearTimeout(timer);
            inFlight[player] = false;
            return answer;
        });
    }

    /**
     * What went wrong, in words.
     *
     * A provider that refuses a browser refuses the preflight, and a refused
     * preflight reaches javascript as a bare TypeError with nothing in it -
     * no status, no reason, deliberately, so a page cannot probe what it is
     * not allowed to reach. That is indistinguishable from the network being
     * down, so the message has to offer both and say which is likelier.
     */
    function explain(err, provider) {
        if (err.name === 'AbortError') {
            return 'Gave up waiting after ' + (TIMEOUT / 1000) + 's.';
        }
        if (err instanceof TypeError) {
            return 'The request never reached ' + provider.label + '. Either you ' +
                'are offline, or this provider does not accept calls from a ' +
                'browser \u2014 which it refuses in a way a page cannot tell apart ' +
                'from the first. ' +
                (provider.cors === 'checked'
                    ? 'Browser calls to this one are known to work, so check the network.'
                    : 'Browser support for this one was never verified. Run the ' +
                      'preflight in the README to find out, and put it behind a ' +
                      'small local proxy if it says no.');
        }
        return err.message;
    }

    function busy(player) {
        return inFlight[player];
    }

    return {
        configure: configure, release: release, name: name, think: think,
        busy: busy, cost: cost, openLog: openLog,
        cap: function () { return cap; }
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = LLM;
