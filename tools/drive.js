#!/usr/bin/env node
/**
 * tools/drive.js - the game, from a terminal.
 *
 * An agent playing this has a shell and nothing else. This turns a whole turn
 * into one command: ask what the table looks like, pick a shot, read what it
 * did. No browser automation library to learn, no page objects, no promises to
 * chain - just text in and text out, which is what something that reasons in
 * sentences can actually use.
 *
 *     node tools/drive.js open               # chrome, with the game on it
 *     node tools/drive.js wait 1             # blocks until it is your turn
 *     node tools/drive.js play 2 0.6         # take the second pot, medium pace
 *
 * It drives a Chrome that is already running rather than one it owns, so the
 * window stays on screen between commands and a person can watch the match
 * happen. That is the whole reason it speaks CDP directly instead of through
 * playwright: a debugger socket is a few lines of node with nothing installed,
 * and the repo stays as dependency free as the game it drives.
 *
 * Exit codes: 0 when the page answered, 1 when it could not be reached, 2 when
 * the answer was that the game is over - so a shell loop can stop on its own.
 */
'use strict';

var DEFAULT_ENDPOINT = process.env.BILLIARDS_CDP || 'http://127.0.0.1:9222';
var SHOT_LIMIT = 120000;          // a shot that has not settled by now is stuck

/* ------------------------------------------------------------------ *
 * talking to the page
 * ------------------------------------------------------------------ */

/**
 * The debugger socket of the tab holding the game.
 *
 * Chrome lists every tab it has; the game is the one serving index.html. If
 * there is exactly one page it is taken on trust, because a browser opened by
 * `drive.js open` has nothing else in it.
 */
async function findPage(endpoint, match) {
    var list;
    try {
        var res = await fetch(endpoint + '/json/list');
        if (!res.ok) throw new Error('the debugger answered ' + res.status);
        list = await res.json();
    } catch (err) {
        die('No Chrome is listening on ' + endpoint + ' (' + err.message + ').\n' +
            'Start one with:  node tools/drive.js open');
    }

    var pages = list.filter(function (t) {
        return t.type === 'page' && t.webSocketDebuggerUrl;
    });
    var want = pages.filter(function (t) {
        return t.url.indexOf(match || 'index.html') >= 0;
    });
    if (!want.length && pages.length === 1) want = pages;

    if (!want.length) {
        die('Chrome is running but the game is not open in it.' +
            (pages.length ? '\nTabs it does have:\n  ' +
                pages.map(function (t) { return t.url; }).join('\n  ') : ''));
    }
    return want[0].webSocketDebuggerUrl;
}

function connect(url) {
    return new Promise(function (resolve, reject) {
        var ws = new WebSocket(url);
        ws.addEventListener('open', function () { resolve(ws); });
        ws.addEventListener('error', function () {
            reject(new Error('could not open the debugger socket at ' + url));
        });
    });
}

var seq = 0;

function send(ws, method, params, limit) {
    var id = ++seq;
    return new Promise(function (resolve, reject) {
        var timer = limit && setTimeout(function () {
            ws.removeEventListener('message', onMessage);
            reject(new Error('gave up after ' + Math.round(limit / 1000) + 's'));
        }, limit);

        function onMessage(ev) {
            var msg;
            try { msg = JSON.parse(ev.data); } catch (e) { return; }
            if (msg.id !== id) return;                 // somebody else's reply
            ws.removeEventListener('message', onMessage);
            if (timer) clearTimeout(timer);
            if (msg.error) return reject(new Error(msg.error.message));
            resolve(msg.result);
        }

        ws.addEventListener('message', onMessage);
        ws.send(JSON.stringify({id: id, method: method, params: params}));
    });
}

/**
 * Run an expression in the page and bring back what it evaluates to.
 *
 * `awaitPromise` is what makes a whole shot one command: `play` hands back a
 * promise that settles when the balls do, and the socket simply holds the
 * answer until then.
 */
async function evaluate(ws, expression, limit) {
    var r = await send(ws, 'Runtime.evaluate', {
        expression: expression,
        awaitPromise: true,
        returnByValue: true
    }, limit);

    if (r.exceptionDetails) {
        var e = r.exceptionDetails;
        throw new Error((e.exception && e.exception.description) || e.text);
    }
    return r.result.value;
}

/* ------------------------------------------------------------------ *
 * the commands
 * ------------------------------------------------------------------ */

/**
 * Every argument this tool takes is a number, and every one is checked before
 * it is spliced into an expression. That is not only politeness about types:
 * it is what keeps a mistyped argument a complaint rather than something
 * running in the page.
 */
function num(v, name, fallback) {
    if (v === undefined) {
        if (fallback !== undefined) return fallback;
        die(name + ' is required.');
    }
    var n = Number(v);
    if (!Number.isFinite(n)) die(name + ' has to be a number, not ' + JSON.stringify(v));
    return n;
}

function seatOf(v) {
    if (v === undefined) return 'undefined';
    var n = num(v, 'seat');
    if (n !== 1 && n !== 2) die('seat is 1 or 2, not ' + n);
    return String(n);
}

var COMMANDS = {
    brief: {
        help: 'brief [seat]                        the position in words',
        build: function (a) { return ['Billiards.brief(' + seatOf(a[0]) + ')', SHOT_LIMIT]; }
    },
    wait: {
        help: 'wait <seat>                         block until it is your turn',
        // No limit: waiting on the other player is the job, and how long they
        // take to think is not this tool's business.
        build: function (a) { return ['Billiards.awaitTurn(' + seatOf(a[0]) + ')', 0]; }
    },
    play: {
        help: 'play <n> <power> [side] [vert] [seat]   take pot n from the brief',
        build: function (a) {
            return ['Billiards.play(' + num(a[0], 'n') + ',' + num(a[1], 'power') +
                ',' + num(a[2], 'side', 0) + ',' + num(a[3], 'vert', 0) +
                ',' + seatOf(a[4]) + ')', SHOT_LIMIT];
        }
    },
    aim: {
        help: 'aim <x> <y> <power> [side] [vert] [seat]  shoot at a point, in cm',
        build: function (a) {
            return ['Billiards.aim(' + num(a[0], 'x') + ',' + num(a[1], 'y') +
                ',' + num(a[2], 'power') + ',' + num(a[3], 'side', 0) +
                ',' + num(a[4], 'vert', 0) + ',' + seatOf(a[5]) + ')', SHOT_LIMIT];
        }
    },
    place: {
        help: 'place <x> <y> [seat]                put the cue ball down, in cm',
        build: function (a) {
            return ['Billiards.placeCue(' + num(a[0], 'x') + ',' + num(a[1], 'y') +
                ',' + seatOf(a[2]) + ')', SHOT_LIMIT];
        }
    },
    rack: {
        help: 'rack                                start a new game',
        build: function () {
            return ['(function () { return Billiards.newGame() === false' +
                ' ? "Could not start: the page has no renderer."' +
                ' : Billiards.brief(); })()', SHOT_LIMIT];
        }
    },
    state: {
        help: 'state                               one line, for a shell loop',
        build: function () {
            return ['(function () { var s = Billiards.state; return "phase=" + s.phase +' +
                ' " player=" + (s.player + 1) + " seats=" + s.seats.join(","); })()',
                SHOT_LIMIT];
        }
    }
};

/* ------------------------------------------------------------------ *
 * starting a browser to drive
 * ------------------------------------------------------------------ */

/**
 * Chrome will not open a debugging port on your everyday profile - it has
 * refused that since it became a way for anything on the machine to read your
 * logged-in sessions. So this hands it a scratch profile of its own, which is
 * also why the browser it opens has none of your tabs or extensions in it.
 */
function open(args) {
    var path = require('path');
    var fs = require('fs');
    var os = require('os');
    var spawn = require('child_process').spawn;

    var headless = args.indexOf('--headless') >= 0;
    args = args.filter(function (a) { return a !== '--headless'; });

    var page = args[0] || 'file://' + path.join(__dirname, '..', 'index.html');
    var port = process.env.BILLIARDS_CDP_PORT || '9222';
    var profile = path.join(os.tmpdir(), 'billiards-drive-profile');

    var candidates = [
        process.env.CHROME,
        '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'
    ].filter(Boolean);

    var chrome = candidates.filter(function (c) {
        return c.indexOf('/') < 0 && c.indexOf('\\') < 0 ? true : fs.existsSync(c);
    })[0];

    if (!chrome) {
        die('Could not find Chrome. Set CHROME to its path, or start it yourself:\n' +
            '  chrome --remote-debugging-port=' + port +
            ' --user-data-dir=' + profile + ' "' + page + '"');
    }

    var flags = [
        '--remote-debugging-port=' + port,
        '--user-data-dir=' + profile,
        '--no-first-run',
        '--no-default-browser-check'
    ];
    // A match can be run on a machine with no screen - worth having, though it
    // gives up the one thing this whole arrangement is for.
    if (headless) flags.push('--headless=new', '--window-size=1280,900');

    // Chrome refuses to start as root with its sandbox on, which is the case
    // inside most containers and nowhere else. Asking only when that is true
    // keeps the sandbox for everybody running this as themselves.
    if (process.getuid && process.getuid() === 0) flags.push('--no-sandbox');
    flags.push(page);

    var child = spawn(chrome, flags, {detached: true, stdio: 'ignore'});

    child.on('error', function (err) {
        die('Could not start ' + chrome + ': ' + err.message);
    });
    child.unref();

    console.log('Chrome starting on port ' + port + ' with ' + page);
    console.log('Give it a moment, then: node tools/drive.js brief');
}

/* ------------------------------------------------------------------ *
 * the front door
 * ------------------------------------------------------------------ */

function die(message) {
    console.error(message);
    process.exit(1);
}

function usage() {
    console.log('The game, from a terminal. Chrome has to be running with a\n' +
        'debugging port open - `drive.js open` starts one.\n');
    Object.keys(COMMANDS).forEach(function (name) {
        console.log('  ' + COMMANDS[name].help);
    });
    console.log('  open [url] [--headless]             chrome, with the game on it\n');
    console.log('power runs 0 to 1, side and vert -1 to 1, positions are in cm.\n' +
        'seat is 1 or 2, and passing it stops you moving on your opponent\'s turn.\n' +
        'Exit code is 2 once the game is over, so `while` loops end by themselves.');
}

async function main() {
    var argv = process.argv.slice(2);
    var endpoint = DEFAULT_ENDPOINT;

    var at = argv.indexOf('--endpoint');
    if (at >= 0) {
        endpoint = argv[at + 1];
        argv.splice(at, 2);
    }
    var match;
    at = argv.indexOf('--url');
    if (at >= 0) {
        match = argv[at + 1];
        argv.splice(at, 2);
    }

    var name = argv.shift();
    if (!name || name === 'help' || name === '--help') return usage();
    if (name === 'open') return open(argv);

    var command = COMMANDS[name];
    if (!command) die('No such command: ' + name + '. Try `drive.js help`.');

    var built = command.build(argv);
    var ws = await connect(await findPage(endpoint, match));

    try {
        var answer = await evaluate(ws, built[0], built[1]);
        if (answer === undefined || answer === null) answer = '(no answer)';
        console.log(String(answer));
        if (/^Game over/.test(String(answer))) process.exit(2);
    } finally {
        ws.close();
    }
}

main().catch(function (err) {
    die(err.message);
});
