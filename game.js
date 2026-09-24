/**
 * game.js - eight ball on top of phys.js and render.js.
 *
 * Owns the rules (groups, fouls, ball in hand), the input handling and the HUD.
 * The physics never knows about any of it; it just rolls balls around.
 */
(function () {
    'use strict';

    var TABLE_W = 2.24, TABLE_H = 1.12;
    var MIN_POWER = 0.6, MAX_POWER = 9.0;
    var CHARGE_TIME = 1.1;          // seconds from no power to full

    var world, view, cueBall;
    var rects = null;

    var state = {
        phase: 'ballInHand',        // ballInHand | aiming | charging | rolling | over
        player: 0,
        groups: [null, null],       // 'solids' | 'stripes' per player
        open: true,
        broken: false,
        kitchenOnly: true,          // ball in hand restricted behind the head string
        angle: 0,
        power: 0,
        chargeStart: 0,
        side: 0,
        vert: 0,
        elevation: 0,               // how far the cue is raised, in degrees
        timeScale: 1,               // slow the table down, for a closer look
        message: 'Break them up: place the cue ball behind the line and fire.',
        pocketed: [],
        ghost: null,                // cue ball position while placing it
        hint: null,                 // the shot the network suggested, if asked
        lining: null,               // the network's shot, standing on the line
        aiPause: 0,                 // don't start thinking before this moment
        split: 0.62,                // how much of the screen the upper view gets
        // Who is playing each seat. One of 'human', 'net' (the value network),
        // 'llm' (a language model over its provider's api) or 'driver' (something
        // operating the page from outside). Two bitmasks used to do this between
        // them and could not express a seat being played by a third thing; one
        // name per seat can, and every matchup falls out of it.
        seats: ['human', 'human']
    };

    var shot = null;

    /* ------------------------------------------------------------------ *
     * setup
     * ------------------------------------------------------------------ */

    function shuffle(a) {
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }

    /** Standard triangle: apex on the foot spot, the 8 in the middle, a solid
     *  and a stripe in the back corners, everything else mixed up. */
    function rackOrder() {
        var solids = shuffle([2, 3, 4, 5, 6, 7]);
        var stripes = shuffle([9, 10, 11, 12, 13, 14, 15]);

        var slots = new Array(15);
        slots[0] = 1;                       // apex
        slots[4] = 8;                       // centre of the third row
        slots[10] = solids.pop();           // back corners, one of each
        slots[14] = stripes.pop();

        var rest = shuffle(solids.concat(stripes));
        for (var i = 0; i < 15; i++) {
            if (slots[i] === undefined) slots[i] = rest.pop();
        }
        return slots;
    }

    function buildWorld() {
        world = Phys.createTable({width: TABLE_W, height: TABLE_H});
        for (var id = 0; id < 16; id++) world.add(new Phys.Ball(id, 0, 0));
        cueBall = world.ball(0);
    }

    /** Drop the fifteen object balls into a fresh triangle. */
    function rack() {
        var r = world.radius;
        var gap = 2 * r * 1.02;
        var footX = TABLE_W * 0.72;

        var order = rackOrder(), n = 0;
        for (var row = 0; row < 5; row++) {
            for (var j = 0; j <= row; j++) {
                var ball = world.ball(order[n++]);
                ball.placeAt(footX + row * gap * 0.866, TABLE_H / 2 + (j - row / 2) * gap);
            }
        }
        cueBall.placeAt(TABLE_W * 0.22, TABLE_H / 2);
    }

    function newGame() {
        if (typeof AI !== 'undefined') AI.cancel();
        state.lining = null;
        state.aiPause = 0;
        if (!world) {
            buildWorld();
            var canvas = document.getElementById('scene');
            try {
                view = new Renderer(canvas, world);
            } catch (err) {
                // No WebGL: hardware acceleration switched off, a blocklisted
                // driver, or a browser that has stopped falling back to
                // software WebGL on its own. The game plays on with both views
                // drawn by hand on a plain 2d canvas.
                try {
                    view = new Renderer2D(canvas, world);
                } catch (flatErr) {
                    noWebGL(err);
                    return false;
                }
                flatMode(err);
            }
        }
        rack();
        state.phase = 'ballInHand';
        cueBall.lift();
        state.player = 0;
        state.groups = [null, null];
        state.open = true;
        state.broken = false;
        state.kitchenOnly = true;
        state.power = 0;
        state.side = state.vert = 0;
        state.angle = 0;
        state.seats = ['human', 'human'];
        state.pocketed = [];
        state.message = 'Break them up: place the cue ball behind the line and fire.';
        state.ghost = null;

        drawSpinWidget();
        updateHud();
        return true;
    }

    /* ------------------------------------------------------------------ *
     * rules
     * ------------------------------------------------------------------ */

    // The rulebook itself lives in rules.js, so that a headless match can play
    // by exactly the same rules this page does. What is left here is the state
    // it reads and the things it deliberately does not do: the phase machine,
    // the sounds, and the HUD.
    function groupOf(id) {
        return Rules.groupOf(id);
    }

    function remaining(group) {
        return Rules.remaining(world, group);
    }

    function shoot() {
        clearHint();
        // the legal target has to be read now: by the time the shot is judged,
        // the ball it was aimed at may already be off the table
        shot = Rules.newShot(world, state.groups, state.player, state.broken);
        world.strike(cueBall, Math.cos(state.angle), Math.sin(state.angle),
            state.power, state.side, state.vert, state.elevation * Math.PI / 180);
        state.phase = 'rolling';
        state.broken = true;
        setElevation(0);            // the cue goes back down for the next shot
        Sound.hit(state.power / MAX_POWER);
        updatePowerBar();      // empty the shoot button now, not on the next frame
    }

    function trackEvents(events) {
        if (shot) Rules.track(shot, events);
        events.forEach(function (e) {
            if (e.type === 'ballHit') {
                Sound.click(e.speed);
            } else if (e.type === 'cushion') {
                Sound.cushion(e.speed);
            } else if (e.type === 'pot') {
                if (e.ball.id !== 0) state.pocketed.push(e.ball.id);
                Sound.pot();
            }
        });
    }

    /**
     * Apply what the rulebook made of the shot. `Rules.resolve` decides; this
     * moves the game's own state to match and says it out loud.
     */
    function resolveShot() {
        var out = Rules.resolve(world, {
            groups: state.groups, player: state.player, open: state.open
        }, shot);

        if (out.respotEight) {
            Rules.respot(world, world.ball(8));
            var idx = state.pocketed.indexOf(8);
            if (idx >= 0) state.pocketed.splice(idx, 1);
        }

        if (out.groups) {
            state.groups[0] = out.groups[0];
            state.groups[1] = out.groups[1];
            state.open = out.open;
        }

        state.message = out.message;

        if (out.gameOver) {
            state.phase = 'over';
            return;
        }

        state.player = out.player;
        if (out.ballInHand) {
            takeBallInHand(out.kitchenOnly);
        } else {
            state.phase = 'aiming';
        }
        state.power = 0;
    }

    /* ------------------------------------------------------------------ *
     * ball in hand
     * ------------------------------------------------------------------ */

    /**
     * Hand the cue ball to the player at the table. The ball comes off the
     * cloth while they decide: all they are moving is a marker, so it cannot
     * shoulder the balls already down out of position.
     */
    function takeBallInHand(kitchenOnly) {
        cueBall.lift();
        state.phase = 'ballInHand';
        state.kitchenOnly = !!kitchenOnly;
        state.ghost = null;
    }

    function placementLegal(x, y) {
        return Rules.placementLegal(world, x, y, state.kitchenOnly);
    }

    function placeCueBall(x, y) {
        if (!placementLegal(x, y)) return false;
        clearHint();
        cueBall.placeAt(x, y);
        state.phase = 'aiming';
        state.message = 'Player ' + (state.player + 1) + ' to shoot.';
        return true;
    }

    /* ------------------------------------------------------------------ *
     * input
     * ------------------------------------------------------------------ */

    function aimAt(point) {
        state.angle = Math.atan2(point.y - cueBall.y, point.x - cueBall.x);
    }

    function pointerPos(e) {
        return rects ? view.screenToTable(e.clientX, e.clientY, rects) : null;
    }

    var dragging = false;
    var chargePointer = null;     // which pointer started the charge, if any

    /** True if the pointer is over the cue ball's pane rather than the table's. */
    function insetHit(e) {
        if (!rects) return false;
        var box = document.getElementById('scene').getBoundingClientRect();
        var r = rects.pov;
        var x = e.clientX - box.left, y = e.clientY - box.top;
        return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    }

    function onPointerDown(e) {
        if (insetHit(e)) {          // tap the small view to bring it up front
            view.swapViews();
            return;
        }

        if (!humanTurn()) return;        // the network has this one

        var p = pointerPos(e);
        if (state.phase === 'ballInHand') {
            if (p) {
                state.ghost = p;
                placeCueBall(p.x, p.y);
            }
            return;
        }
        if (state.phase !== 'aiming') return;

        dragging = true;
        capture(e.target, e.pointerId);
        if (p) aimAt(p);

        // A finger aims and nothing else: the shot goes off with the shoot
        // button, so dragging around the table cannot fire one by accident.
        // A mouse keeps the old feel - hold the button to charge, let go to hit.
        if (e.pointerType === 'mouse') startCharge(e.pointerId);
    }

    function onPointerMove(e) {
        if (e.pointerType !== 'mouse' && !dragging) return;
        if (!humanTurn()) return;
        var p = pointerPos(e);
        if (!p) return;
        if (state.phase === 'ballInHand') state.ghost = p;
        else if (state.phase === 'aiming') aimAt(p);
    }

    function onPointerUp(e) {
        dragging = false;
        releaseCharge(e.pointerId);
    }

    function capture(el, id) {
        if (el && el.setPointerCapture && id !== undefined) {
            try { el.setPointerCapture(id); } catch (err) { /* not captureable */ }
        }
    }

    function startCharge(pointerId) {
        if (state.phase !== 'aiming' || !humanTurn()) return;
        state.phase = 'charging';
        state.chargeStart = performance.now();
        state.power = MIN_POWER;
        chargePointer = pointerId === undefined ? null : pointerId;
    }

    /** How hard the shot is by now, from how long the button has been down. */
    function chargedPower(now) {
        var held = (now - state.chargeStart) / 1000;
        return MIN_POWER + (MAX_POWER - MIN_POWER) * Math.min(held / CHARGE_TIME, 1);
    }

    /** Let go: only the pointer that started the charge can take the shot. */
    function releaseCharge(pointerId) {
        if (state.phase !== 'charging') return;
        if (!humanTurn()) return;       // the network is drawing its own cue back
        if (chargePointer !== null && pointerId !== undefined && pointerId !== chargePointer) return;
        chargePointer = null;
        // read the power now rather than trusting the last frame, so a slow
        // frame cannot rob the shot of the power the player felt they held
        state.power = chargedPower(performance.now());
        shoot();
    }

    /* ---------------------------- buttons ----------------------------- */

    /** Wire a button for press and hold rather than click. */
    function holdButton(el, onDown, onUp) {
        el.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            if (el.disabled) return;
            el.classList.add('held');
            capture(el, e.pointerId);
            onDown(e);
        });

        function end(e) {
            if (!el.classList.contains('held')) return;
            el.classList.remove('held');
            onUp(e);
        }
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
        el.addEventListener('lostpointercapture', end);
    }

    // Aim nudging: a tap moves the aim by a hair, holding sweeps, and the
    // longer it is held the faster it goes. The sweep is driven from the main
    // loop in degrees per second, so it reads the same on a slow phone as on a
    // desktop.
    var nudge = {dir: 0, since: 0, last: 0};

    function startNudge(dir) {
        if (!humanTurn()) return;
        nudge.dir = dir;
        nudge.since = nudge.last = performance.now();
        state.angle += dir * 0.0016;      // about a twentieth of a degree
    }

    function stopNudge() {
        nudge.dir = 0;
    }

    /**
     * Sweep on its own clock rather than the simulation's: the physics step is
     * clamped for stability, and on a slow phone that clamp would turn a sweep
     * into a crawl.
     */
    function sweepAim(now) {
        if (!nudge.dir) return;
        var dt = Math.min((now - nudge.last) / 1000, 0.25);
        nudge.last = now;

        var held = (now - nudge.since) / 1000;
        if (held < 0.2) return;           // a tap should not turn into a sweep
        state.angle += nudge.dir * Math.min(0.35 + (held - 0.2) * 1.2, 1.4) * dt;
    }

    // keys that change the shot rather than the page: ignored while the network
    // is at the table, the same as a click on the cloth
    var SHOT_KEYS = {
        Space: 1, ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1,
        KeyA: 1, KeyD: 1, KeyC: 1, BracketLeft: 1, BracketRight: 1
    };

    function onKeyDown(e) {
        if (e.repeat && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
        if (SHOT_KEYS[e.code] && !humanTurn()) return;
        switch (e.code) {
            case 'Space':
                e.preventDefault();
                startCharge();
                break;
            case 'ArrowLeft':
                state.angle -= e.shiftKey ? 0.0008 : 0.006;
                break;
            case 'ArrowRight':
                state.angle += e.shiftKey ? 0.0008 : 0.006;
                break;
            case 'ArrowUp':
                state.vert = Phys.clamp(state.vert + 0.1, -0.7, 0.7);
                drawSpinWidget();
                break;
            case 'ArrowDown':
                state.vert = Phys.clamp(state.vert - 0.1, -0.7, 0.7);
                drawSpinWidget();
                break;
            case 'KeyA':
                state.side = Phys.clamp(state.side - 0.1, -0.7, 0.7);
                drawSpinWidget();
                break;
            case 'KeyD':
                state.side = Phys.clamp(state.side + 0.1, -0.7, 0.7);
                drawSpinWidget();
                break;
            case 'KeyC':
                state.side = state.vert = 0;
                drawSpinWidget();
                break;
            case 'BracketLeft':
                setElevation(state.elevation - (e.shiftKey ? 1 : 5));
                break;
            case 'BracketRight':
                setElevation(state.elevation + (e.shiftKey ? 1 : 5));
                break;
            case 'KeyV':
                view.swapViews();
                break;
            case 'KeyH':
                askHint();
                break;
            case 'KeyM':
                Sound.toggle();
                break;
            case 'KeyR':
                newGame();
                break;
            case 'KeyL':
                Panels.resetAll();      // panels back to their corners
                break;
        }
    }

    function onKeyUp(e) {
        if (e.code === 'Space') releaseCharge();
    }

    /**
     * How far the cue is raised, in degrees. Level is a normal shot; raise it
     * and the ball is driven into the cloth and hops, which is how you get over
     * a ball that is in the way.
     */
    function setElevation(deg) {
        state.elevation = Phys.clamp(Math.round(deg), 0, 60);

        var slider = document.getElementById('elev');
        if (slider && +slider.value !== state.elevation) slider.value = state.elevation;

        var value = document.getElementById('elevvalue');
        if (value) value.innerHTML = state.elevation + '&deg;';

        var hint = document.getElementById('elevhint');
        if (hint) {
            hint.textContent = state.elevation === 0 ? 'level' :
                (state.elevation < 25 ? 'a little air' : 'jump shot');
        }
    }

    /** The little cue ball dial that sets where the tip strikes. */
    function drawSpinWidget() {
        var cv = document.getElementById('spin');
        if (!cv) return;

        // the dial grows on touch screens, so follow the box it is given
        var dpr = window.devicePixelRatio || 1;
        var wanted = Math.round((cv.clientWidth || 78) * dpr);
        if (wanted && cv.width !== wanted) {
            cv.width = cv.height = wanted;
        }

        var ctx = cv.getContext('2d');
        var size = cv.width, c = size / 2, rad = size / 2 - size * 0.05;

        ctx.clearRect(0, 0, size, size);
        var g = ctx.createRadialGradient(c - rad * 0.3, c - rad * 0.3, rad * 0.1, c, c, rad);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#b9bcc2');
        ctx.beginPath();
        ctx.arc(c, c, rad, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();

        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath();
        ctx.moveTo(c - rad, c); ctx.lineTo(c + rad, c);
        ctx.moveTo(c, c - rad); ctx.lineTo(c, c + rad);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(c + state.side * rad, c - state.vert * rad, rad * 0.16, 0, Math.PI * 2);
        ctx.fillStyle = '#2a4a8c';
        ctx.fill();
    }

    function spinFromPointer(e) {
        var cv = document.getElementById('spin');
        var box = cv.getBoundingClientRect();
        var rad = box.width / 2 - box.width * 0.05;
        var sx = (e.clientX - box.left - box.width / 2) / rad;
        var sy = -(e.clientY - box.top - box.height / 2) / rad;

        var len = Math.sqrt(sx * sx + sy * sy);
        if (len > 0.7) { sx = sx / len * 0.7; sy = sy / len * 0.7; }
        state.side = sx;
        state.vert = sy;
        drawSpinWidget();
    }

    /* ------------------------------------------------------------------ *
     * HUD
     * ------------------------------------------------------------------ */

    function chip(id, dim) {
        var color = BallSkins.color(id);
        var stripe = id > 8;
        return '<span class="chip' + (dim ? ' gone' : '') + (stripe ? ' striped' : '') +
            '" style="--c:' + color + '">' + id + '</span>';
    }

    var SEAT_LABEL = {human: 'AI', net: 'AI', llm: 'LLM', driver: 'EXT'};

    /**
     * What the seat chip says it will do. It cycles rather than toggling now
     * that a seat can be played by three different things, so the tooltip has
     * to name the next stop as well as the current one.
     */
    function seatTitle(p, kind) {
        var who = 'Player ' + (p + 1);
        if (kind === 'net') return who + ' is played by the network \u2014 click for a language model';
        if (kind === 'llm') return who + ' is played by ' + llmName(p) + ' \u2014 click to take the seat back';
        if (kind === 'driver') return who + ' is played from outside the page \u2014 click to take the seat back';
        return 'Let the network play ' + who.toLowerCase();
    }

    function llmName(p) {
        return (typeof LLM !== 'undefined' && LLM.name && LLM.name(p)) || 'a language model';
    }

    function groupLabel(p) {
        if (state.groups[p]) return state.groups[p];
        return 'open';
    }

    function updateHud() {
        var turn = document.getElementById('turn');
        turn.textContent = state.phase === 'over' ? 'Game over' : 'Player ' + (state.player + 1);
        turn.className = 'p' + state.player;

        document.getElementById('message').textContent = state.message;

        for (var p = 0; p < 2; p++) {
            var el = document.getElementById('group' + p);
            var group = state.groups[p];
            var kind = state.seats[p];
            var html = '<button type="button" class="seat ' + kind +
                (waiting['seat' + p] ? ' loading' : '') +
                '" data-seat="' + p + '" title="' + seatTitle(p, kind) +
                '">' + SEAT_LABEL[kind] + '</button>' +
                '<b>Player ' + (p + 1) + '</b> <span class="grp">' + groupLabel(p) + '</span> ';
            var ids = group === 'solids' ? [1, 2, 3, 4, 5, 6, 7]
                : group === 'stripes' ? [9, 10, 11, 12, 13, 14, 15] : [];
            ids.forEach(function (id) {
                html += chip(id, !world.ball(id).active);
            });
            if (group && remaining(group) === 0) html += chip(8, !world.ball(8).active);
            el.innerHTML = html;
            el.className = 'groupline' + (state.player === p ? ' active' : '');
        }
    }

    // updateHud rebuilds markup, so only run it when there is something new to say
    var hudShown = null;

    function refreshHud() {
        // Which balls are still up belongs in the key as much as the message
        // does: the chips in the score panel grey out the moment a ball drops,
        // not when the shot is finally judged, so a pot has to count as
        // something new to say.
        var down = 0;
        for (var i = 0; i < world.balls.length; i++) {
            if (!world.balls[i].active) down |= 1 << i;
        }

        var key = state.player + '|' + state.phase + '|' + state.message + '|' + down;
        if (key === hudShown) return;
        hudShown = key;
        updateHud();
    }

    function updatePowerBar() {
        var pct = Math.max(0, Math.round(100 * (state.power - MIN_POWER) / (MAX_POWER - MIN_POWER)));

        var bar = document.getElementById('powerfill');
        if (bar) bar.style.width = pct + '%';

        // where the suggested shot sits on the bar, for a player to charge up to
        var mark = document.getElementById('powermark');
        if (mark) {
            var want = state.hint && state.hint.power;
            mark.style.display = want ? 'block' : 'none';
            if (want) {
                mark.style.left = Math.max(0, Math.min(100,
                    100 * (want - MIN_POWER) / (MAX_POWER - MIN_POWER))) + '%';
            }
        }

        // the shoot button fills up as it is held, so a thumb over the bar
        // still knows how hard the shot is going to be
        var fill = document.getElementById('shootfill');
        if (fill) fill.style.height = (state.phase === 'charging' ? pct : 0) + '%';

        var shoot = document.getElementById('shoot');
        if (shoot) shoot.disabled = !(state.phase === 'aiming' || state.phase === 'charging');

        // asking for a hint only means something on your own turn
        var hint = document.getElementById('ai');
        if (hint) {
            hint.disabled = !humanTurn() ||
                (state.phase !== 'aiming' && state.phase !== 'ballInHand');
            hint.classList.toggle('loading', !!waiting.hint);
        }
    }

    /**
     * Give the two views the part of the screen the panels have left. Only a
     * panel parked against the top or bottom edge and wide enough to matter
     * costs them anything; a narrow one, or one dragged into the middle, simply
     * floats over a view - which is what moving it there asked for.
     */
    /** A panel lifted out of its band is floating, and costs the views nothing. */
    function docked(el) {
        return el && !el.style.left;
    }

    /**
     * The views get everything the bands leave them. The top band is however
     * tall the score and the buttons make it, the bottom band is the controls,
     * and a panel dragged out of either one stops counting.
     */
    function paneRegion() {
        var top = 0, bottom = 0;

        var bar = document.getElementById('topbar');
        if (bar) {
            var band = bar.getBoundingClientRect();
            if (band.height > 4) top = band.bottom + 6;
        }

        var controls = document.getElementById('controls');
        if (docked(controls)) {
            var r = controls.getBoundingClientRect();
            bottom = Math.max(0, window.innerHeight - r.top) + 6;
        }
        return {top: top, bottom: bottom};
    }

    function placeInset() {
        var free = paneRegion();
        view.setSplit(state.split);
        view.setPaneRegion(free.top, free.bottom);
        view.setTableInsets({});
    }

    /** Label each pane, and park the seam handle between them. */
    function positionInsetFrame() {
        var seam = document.getElementById('seam');
        if (!rects || !seam) return;

        var upper = view.isSwapped() ? rects.pov : rects.table;
        var lower = view.isSwapped() ? rects.table : rects.pov;

        // bottom left of each pane: the top corners belong to the panels
        function caption(el, pane, text) {
            if (!el) return;
            el.style.left = pane.x + 'px';
            el.style.top = (pane.y + pane.h - 22) + 'px';
            el.textContent = text;
        }
        caption(document.getElementById('capupper'), upper,
            view.isSwapped() ? 'CUE BALL' : 'TABLE');
        caption(document.getElementById('caplower'), lower,
            view.isSwapped() ? 'TABLE' : 'CUE BALL');

        var s = rects.seam;
        seam.classList.toggle('vertical', !!s.vertical);
        if (s.vertical) {
            seam.style.left = (s.x + s.w / 2) + 'px';
            seam.style.top = s.y + 'px';
            seam.style.height = s.h + 'px';
        } else {
            seam.style.left = '0px';
            seam.style.top = (s.y + s.h / 2) + 'px';
            seam.style.height = '';
        }
    }

    /* ------------------------------------------------------------------ *
     * the trained player
     * ------------------------------------------------------------------ */

    /**
     * Hand a turn to the network when it is that player's.
     *
     * Called once a frame. It never blocks: starting a turn only sets the
     * search up, `AI.tick` spends a few milliseconds of each frame on it, and
     * the shot is played on whichever frame the answer arrives. The table goes
     * on drawing throughout, which is the whole reason it is arranged this way.
     */
    /** Is the value network playing this seat? */
    function aiPlays(player) {
        return state.seats[player] === 'net';
    }

    /** Is anything other than a person playing it? */
    function machinePlays(player) {
        return state.seats[player] !== 'human';
    }

    /** Is a seat of this kind in the game at all? */
    function anySeat(kind) {
        return state.seats[0] === kind || state.seats[1] === kind;
    }

    /**
     * How fast the table should run right now. Only the network's own shots are
     * slowed: a person is watching their own cue ball and does not need help
     * following it.
     */
    /**
     * A shot nobody at the table chose goes by too fast to follow, so the
     * network's shots roll slower than real time. A driver's shots are watched
     * the same way and for the same reason.
     */
    function paceScale() {
        return machinePlays(state.player) ? AI_PACE : 1;
    }

    /** Wait a beat before the network starts on its next turn. */
    function pause(ms) {
        state.aiPause = performance.now() + ms;
    }

    function pausing() {
        return state.aiPause && performance.now() < state.aiPause;
    }

    /**
     * Is the table the person's to play right now? Everything a player does -
     * aiming, charging, putting the ball down - goes through this, so that a
     * stray click during the network's turn cannot take the shot for it.
     */
    function humanTurn() {
        return state.seats[state.player] === 'human';
    }
    /**
     * Hand a turn to the network when it is that player's.
     *
     * Called once a frame from `pumpAI`. It never blocks: starting a turn only
     * sets the search up, and the shot is played on whichever frame the answer
     * arrives.
     */
    function playAI() {
        if (!aiPlays(state.player)) { AI.cancel('play'); return; }
        if (state.phase !== 'aiming' && state.phase !== 'ballInHand') return;
        if (AI.busy() || state.lining || pausing()) return;

        AI.think(world, position(), 'play');
    }

    /**
     * Hand a turn to a language model when it is that seat's.
     *
     * Same arrangement as the network's turn and for the same reason: starting
     * one returns immediately and the answer is played on whichever frame it
     * arrives, so the table never stops drawing while a model is thinking. The
     * difference is that this one is waiting on a network request rather than
     * on a search, so it can also simply fail, and a seat that cannot play is
     * handed back rather than left stuck.
     */
    function pumpLLM() {
        if (typeof LLM === 'undefined') return;
        var p = state.player;
        if (state.seats[p] !== 'llm') return;
        if (state.phase !== 'aiming' && state.phase !== 'ballInHand') return;
        if (LLM.busy(p) || state.lining || pausing()) return;

        pause(60000);                  // nothing else starts a turn while this one runs
        var forSeat = p;
        LLM.think(p, briefFor(p + 1)).then(function (answer) {
            state.aiPause = 0;
            if (state.seats[forSeat] !== 'llm' || state.player !== forSeat) return;
            if (!answer) {
                setSeat(forSeat, 'human');
                state.message = 'Player ' + (forSeat + 1) +
                    ' could not play: the seat is yours.';
                updateHud();
                return;
            }
            playAnswer(forSeat, answer);
        });
    }

    /** Turn what the model said into a shot on the table. */
    function playAnswer(player, answer) {
        var api = window.Billiards;

        if (state.phase === 'ballInHand') {
            var put = answer.action === 'place'
                ? api.placeCue(answer.x, answer.y)
                : 'not a placement';
            // A spot that is off the table or on top of a ball is refused, and
            // so is a shot answered where a placement was asked for. Either
            // way the turn has to go somewhere, so it goes somewhere legal.
            if (put.indexOf('placed') < 0) {
                api.placeCue(state.kitchenOnly ? 40 : 112, 56);
            }
            return;
        }

        if (answer.action === 'pot') api.play(answer.pot, answer.power, answer.side, answer.vert);
        else api.aim(answer.x, answer.y, answer.power, answer.side, answer.vert);
    }

    /** The position as the players and the network both see it. */
    function position() {
        return {
            groups: state.groups, player: state.player, open: state.open,
            broken: state.broken, ballInHand: state.phase === 'ballInHand',
            kitchenOnly: state.kitchenOnly
        };
    }

    /**
     * Give whatever is being worked on a slice of this frame, and act on it
     * once it is done. Both the seats the network plays and the hint button go
     * through here, so only one turn is ever being thought about at a time.
     */
    function pumpAI() {
        if (typeof AI === 'undefined' || !AI.ready()) return;
        if (anySeat('net')) playAI();
        if (!AI.busy()) return;

        AI.tick(6);
        var answer = AI.poll();
        if (!answer) return;

        if (answer.failed) {
            // hand the seat back rather than sit there stuck
            if (answer.purpose === 'play') setSeat(state.player, 'human');
            state.message = 'The AI stopped: ' + answer.failed.message;
            updateHud();
            return;
        }

        if (answer.purpose === 'hint') { showHint(answer); return; }

        if (answer.place) {
            state.ghost = answer.place;
            placeCueBall(answer.place.x, answer.place.y);
            updateHud();
        } else if (answer.shot && state.phase === 'aiming') {
            takeShot(answer.shot, answer.chosen);
        }
    }

    /**
     * Line the shot up, then play it.
     *
     * Firing the moment the search returns means the cue is never drawn at the
     * angle it chose: the balls simply move. So the network takes its shot the
     * way a person does - it stands the cue on the line and lets you see it,
     * then draws back to the speed it picked, and only then strikes.
     */
    /*
     * How the network paces itself, in milliseconds.
     *
     * It is not in a hurry. Played at the speed a person plays at, its turns go
     * by faster than they can be read: the cue appears at an angle, the balls
     * move, and whatever it was doing is over before you have found the ball it
     * was aiming at. So it lingers on the line with the guides showing, draws
     * back slowly enough to see, rolls the balls at about two thirds speed, and
     * waits a beat afterwards before starting on the next one.
     */
    var LINE_UP = 1100;              // cue on the line, guides showing
    var DRAW_BACK = 550;             // pulling back to the speed it chose
    var AFTER_SHOT = 900;            // a beat to take in where the balls finished
    var AI_PACE = 0.65;              // how fast its shots roll, against real time

    function takeShot(shot, chosen) {
        state.angle = shot.angle;
        state.side = shot.side || 0;
        state.vert = shot.vert || 0;
        setElevation((shot.elevation || 0) * 180 / Math.PI);
        state.power = 0;
        drawSpinWidget();

        // Say what it is going for. The guides on the cloth show it too, but
        // reading a line takes longer than reading a number, and knowing which
        // ball to watch is most of being able to follow the game.
        if (chosen && chosen.ball) {
            state.message = 'Player ' + (state.player + 1) + ' is going for the ' +
                chosen.ball.id + '.';
            updateHud();
        }

        state.lining = {
            power: Phys.clamp(shot.power, MIN_POWER, MAX_POWER),
            since: performance.now()
        };
    }

    /**
     * Walk a lined up shot through to the strike. The cue pulls back as the
     * power climbs, which is the same thing the renderer draws for a person
     * holding the shoot button down.
     */
    function lineUp(now) {
        if (!state.lining) return;
        if (state.phase !== 'aiming' && state.phase !== 'charging') {
            state.lining = null;                 // the turn moved on underneath it
            return;
        }

        var held = now - state.lining.since;
        if (held < LINE_UP) {
            state.power = 0;                     // just standing on the line
            return;
        }

        var through = Math.min((held - LINE_UP) / DRAW_BACK, 1);
        state.phase = 'charging';
        state.power = MIN_POWER + (state.lining.power - MIN_POWER) * through;

        if (through >= 1) {
            state.power = state.lining.power;
            state.lining = null;
            shoot();
        }
    }

    /* ---------------------------- the seats --------------------------- */

    /** Hand one seat to something, or take it back. */
    function setSeat(player, kind) {
        if (state.seats[player] === 'llm' && kind !== 'llm' && typeof LLM !== 'undefined') {
            LLM.release(player);
        }
        state.seats[player] = kind;
        if (typeof AI !== 'undefined' && !aiPlays(state.player)) AI.cancel('play');
        updateHud();
    }

    /**
     * A seat button was pressed. The model has to be there before the network
     * can take a seat, and the first time that is a download - a megabyte and a
     * half of tensorflow plus the model - so the button says what it is doing
     * rather than appearing to have been ignored.
     */
    function askSeat(player) {
        var next = {human: 'net', net: 'llm', llm: 'human', driver: 'human'};
        var want = next[state.seats[player]];

        if (want === 'human') { setSeat(player, 'human'); return; }

        if (want === 'llm') {
            // Skip straight past a language model seat when nothing is set up
            // to answer for it, rather than parking the seat somewhere it
            // cannot play from.
            if (typeof LLM === 'undefined' || !LLM.configure) {
                setSeat(player, 'human');
                return;
            }
            LLM.configure(player, function (ok) {
                setSeat(player, ok ? 'llm' : 'human');
                if (ok) {
                    state.message = LLM.name(player) + ' is playing player ' +
                        (player + 1) + '.';
                    updateHud();
                }
            });
            return;
        }

        withModel(function () {
            setSeat(player, 'net');
            state.message = state.seats[0] === 'net' && state.seats[1] === 'net'
                ? 'The network is playing itself.'
                : 'The network is playing player ' + (player + 1) + '.';
            updateHud();
        }, 'seat' + player);
    }

    /**
     * Run something once the model is loaded, marking `busyId` as waiting in
     * the meantime. Every way into the network goes through here, so it is
     * fetched at most once however it is asked for.
     */
    var waiting = {};

    function withModel(then, busyId) {
        if (AI.ready()) { then(); return; }
        if (waiting[busyId]) return;

        waiting[busyId] = true;
        updateHud();
        AI.load().then(function () {
            waiting[busyId] = false;
            updateHud();
            then();
        }).catch(function (err) {
            waiting[busyId] = false;
            // A page opened straight off the disk cannot fetch the model:
            // browsers refuse file:// requests from scripts. The game plays
            // fine that way, but the AI needs the files served.
            state.message = window.location.protocol === 'file:'
                ? 'The AI needs the game served over http, not opened from a file. ' +
                    'Everything else works as it is.'
                : 'Could not start the AI: ' + err.message;
            updateHud();
            if (window.console) window.console.error('billiards: ai', err);
        });
    }

    /* ---------------------------- the assist -------------------------- */

    /**
     * Ask what the network would do, without it doing it.
     *
     * The aim, the spin and the cue angle are set to its answer, so the guides
     * on the table show the shot it means. How hard is left to the player: the
     * power bar gets a mark at the speed it chose, and the shot is still taken
     * by hand.
     */
    function askHint() {
        if (!humanTurn() || (state.phase !== 'aiming' && state.phase !== 'ballInHand')) {
            return;
        }
        if (AI.busy()) return;

        withModel(function () {
            if (!humanTurn()) return;           // the turn moved on while it loaded
            AI.think(world, position(), 'hint');
            state.message = 'Working out a shot\u2026';
            updateHud();
        }, 'hint');
    }

    function showHint(answer) {
        if (answer.place) {
            state.ghost = answer.place;
            state.hint = {place: answer.place};
            state.message = 'Put the cue ball on the marked spot.';
            updateHud();
            return;
        }
        if (!answer.shot) return;

        var shot = answer.shot;
        state.angle = shot.angle;
        state.side = shot.side || 0;
        state.vert = shot.vert || 0;
        setElevation((shot.elevation || 0) * 180 / Math.PI);
        drawSpinWidget();

        state.hint = {power: Phys.clamp(shot.power, MIN_POWER, MAX_POWER)};
        state.message = 'Aim and spin set. Hold SHOOT to the mark on the power bar.';
        updateHud();
        updatePowerBar();
    }

    /** A hint is about one shot; anything else that happens clears it. */
    function clearHint() {
        if (!state.hint) return;
        state.hint = null;
        updatePowerBar();
    }

    /**
     * With nobody at the table, a finished rack is the end of the show. When
     * the network has both seats it racks up again, after a pause long enough
     * to read who won.
     */
    var racking = 0;

    function keepPlaying() {
        if (anySeat('human') || state.phase !== 'over') {
            racking = 0;
            return;
        }
        if (!racking) {
            racking = Date.now() + 4000;
            // the rulebook's line ends "press R for a new rack", which is not
            // what happens when nobody is there to press it
            state.message = state.message.replace(/Press R for a new rack\.?$/,
                'Racking up again\u2026');
            updateHud();
        } else if (Date.now() >= racking) {
            racking = 0;
            newGame();
        }
    }

    /* ------------------------------------------------------------------ *
     * sound - short synthesised clicks, no assets to load
     * ------------------------------------------------------------------ */

    var Sound = (function () {
        var ctx = null, on = true;

        function context() {
            if (!on) return null;
            if (!ctx && (window.AudioContext || window.webkitAudioContext)) {
                ctx = new (window.AudioContext || window.webkitAudioContext)();
            }
            return ctx;
        }

        function blip(freq, gain, dur, type) {
            var c = context();
            if (!c || gain <= 0.002) return;
            var osc = c.createOscillator(), amp = c.createGain();
            osc.type = type || 'sine';
            osc.frequency.value = freq;
            amp.gain.setValueAtTime(Math.min(gain, 0.25), c.currentTime);
            amp.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
            osc.connect(amp);
            amp.connect(c.destination);
            osc.start();
            osc.stop(c.currentTime + dur);
        }

        return {
            hit: function (p) { blip(220 + 260 * p, 0.12 + 0.1 * p, 0.09, 'triangle'); },
            click: function (speed) {
                if (speed < 0.06) return;      // ignore balls nudging each other
                blip(700 + Math.min(speed, 4) * 180, 0.03 * Math.min(speed, 3), 0.06);
            },
            cushion: function (speed) {
                if (speed < 0.1) return;
                blip(180 + Math.min(speed, 3) * 40, 0.025 * Math.min(speed, 3), 0.1, 'sawtooth');
            },
            pot: function () { blip(120, 0.14, 0.22, 'square'); },
            toggle: function () { on = !on; return on; }
        };
    })();

    /* ------------------------------------------------------------------ *
     * main loop
     * ------------------------------------------------------------------ */

    var last = 0;
    var complained = {};

    /**
     * One frame. Anything thrown in here would otherwise stop the animation
     * loop for good and leave a blank canvas with the panels still sitting on
     * it - which is what a browser or a cdn serving a stale script alongside a
     * fresh page looks like. Say so once and keep drawing.
     */
    function frame(now) {
        try {
            tick(now);
        } catch (err) {
            var key = String(err && err.message);
            if (!complained[key]) {
                complained[key] = true;
                if (window.console) {
                    window.console.error('billiards: ' + key +
                        ' - if this page was just updated, reload it ignoring the cache');
                }
            }
        }
        window.requestAnimationFrame(frame);
    }

    function tick(now) {
        var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
        last = now;
        dt *= state.timeScale * paceScale();   // 1 is real time; lower is slower

        sweepAim(now);
        lineUp(now);

        if (state.phase === 'charging' && !state.lining) state.power = chargedPower(now);

        if (dt > 0) {
            trackEvents(world.step(dt));
            if (state.phase === 'rolling' && world.atRest()) {
                resolveShot();
                if (aiPlays(state.player)) pause(AFTER_SHOT);
                updateHud();
            }
        }

        // the cue ball is off the table while it is in hand; what follows the
        // pointer is a marker showing where it would be put down
        if (state.phase === 'ballInHand') {
            view.setInHand(state.ghost
                ? {x: state.ghost.x, y: state.ghost.y, legal: placementLegal(state.ghost.x, state.ghost.y)}
                : null);
        } else {
            view.setInHand(null);
        }

        pumpAI();
        pumpLLM();
        pumpWatchers(now);
        keepPlaying();

        placeInset();
        view.syncBalls();

        var aiming = state.phase === 'aiming' || state.phase === 'charging';
        view.setAim(aiming ? {
            ball: cueBall, angle: state.angle, power: state.power,
            side: state.side, vert: state.vert,
            elevation: state.elevation * Math.PI / 180
        } : null);

        refreshHud();
        rects = view.render(cueBall, state.angle);
        positionInsetFrame();
        updatePowerBar();

        document.getElementById('scene').style.cursor =
            (state.phase === 'ballInHand' && state.ghost && !placementLegal(state.ghost.x, state.ghost.y))
                ? 'not-allowed' : 'crosshair';
    }

    /* ------------------------------------------------------------------ */

    /**
     * WebGL would not start, so the game is running on the flat renderer. Say
     * so once, plainly, rather than letting the simpler picture look like a
     * bug - and say what usually brings the proper one back.
     */
    function flatMode(err) {
        var note = document.createElement('div');
        note.id = 'flatnote';
        note.innerHTML = '<b>Running without WebGL.</b> Both views are drawn on a plain ' +
            'canvas, so the picture is simpler; the physics, the rules and every control ' +
            'are the same.' +
            '<br><span style="opacity:0.7">To get the 3d table back, turn on ' +
            '<i>use graphics acceleration when available</i> in the browser\u2019s settings ' +
            'and restart it, or see <b>chrome://gpu</b>.</span>' +
            '<button type="button" id="flatclose" title="Dismiss">\u00d7</button>';
        document.body.appendChild(note);

        function dismiss() {
            if (note.parentNode) note.parentNode.removeChild(note);
        }
        var close = document.getElementById('flatclose');
        if (close) close.addEventListener('click', dismiss);
        window.setTimeout(dismiss, 15000);      // said once, then out of the way

        if (window.console) window.console.warn('billiards: flat renderer', err);
    }

    /**
     * Neither renderer would start: no WebGL, and no 2d canvas to fall back on
     * either. That is a browser setting or a driver, not something this page can
     * work around, so say what happened and what usually fixes it rather than
     * leaving a blank window.
     */
    function noWebGL(err) {
        var has = function (kind) {
            try {
                return !!document.createElement('canvas').getContext(kind);
            } catch (e) {
                return false;
            }
        };
        var webgl2 = has('webgl2');
        var webgl1 = has('webgl') || has('experimental-webgl');

        // The flat renderer has already been tried by the time we get here, so
        // this is a browser that will not draw into a canvas at all.
        var why = '<b>This browser will not draw into a canvas</b>, so there is nowhere ' +
            'to put the table.<br><br>WebGL is usually switched off rather than missing: ' +
            'look at <b>chrome://gpu</b>, turn on <i>use graphics acceleration when ' +
            'available</i> in the browser\u2019s settings and restart it. If the 2d canvas ' +
            'is blocked too, an extension or a policy is switching it off; try another ' +
            'browser, or the same one without extensions.';

        var banner = document.createElement('div');
        banner.id = 'stale';
        banner.innerHTML = why +
            '<br><br><span style="opacity:0.65;font-size:12px">webgl2: ' + webgl2 +
            ' &middot; webgl1: ' + webgl1 + '<br>' +
            (err && err.message ? err.message : err) + '</span>';
        document.body.appendChild(banner);

        if (window.console) {
            window.console.error('billiards: no renderer. webgl2=' + webgl2 +
                ' webgl1=' + webgl1, err);
        }
    }

    /**
     * The page and its scripts have to be the same vintage. A browser or a cdn
     * that pairs a fresh index.html with a stale render.js leaves a blank canvas
     * and a console message nobody reads, so say it on the page instead.
     */
    function checkVersions() {
        var missing = ['render', 'syncBalls', 'setAim', 'setInHand', 'setSplit',
            'setPaneRegion', 'swapViews', 'screenToTable'].filter(function (name) {
            return typeof view[name] !== 'function';
        });
        // a script that did not arrive at all, rather than one that arrived stale
        ['Rules', 'Phys', 'Panels', 'BallSkins'].forEach(function (name) {
            if (typeof window[name] === 'undefined') missing.push(name + '.js');
        });
        if (!missing.length) return true;

        var banner = document.createElement('div');
        banner.id = 'stale';
        banner.innerHTML = 'This page loaded an out of date script (' + missing.join(', ') +
            ' missing).<br>Reload ignoring the cache &mdash; ' +
            '<b>ctrl/cmd + shift + R</b> &mdash; to pick up the current version.';
        document.body.appendChild(banner);
        return false;
    }

    /** Every panel can be dragged clear of the shot. */
    function initPanels() {
        ['status', 'buttons', 'controls'].forEach(function (id) {
            Panels.register(document.getElementById(id), id);
        });
    }

    /** Drag the seam between the two views to give one of them more room. */
    function initSeam() {
        var seam = document.getElementById('seam');
        if (!seam) return;
        var dragging = false;

        seam.addEventListener('pointerdown', function (e) {
            dragging = true;
            seam.classList.add('dragging');
            try { seam.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
            e.preventDefault();
            e.stopPropagation();
        });

        seam.addEventListener('pointermove', function (e) {
            if (!dragging || !rects) return;
            var box = document.getElementById('scene').getBoundingClientRect();
            setSplit(rects.seam.vertical
                ? (e.clientX - box.left) / Math.max(1, box.width)
                : (e.clientY - box.top) / Math.max(1, box.height));
            e.preventDefault();
        });

        function done() {
            if (!dragging) return;
            dragging = false;
            seam.classList.remove('dragging');
            try {
                window.localStorage.setItem('billiards.split', String(state.split));
            } catch (err) { /* nothing worth failing over */ }
        }
        seam.addEventListener('pointerup', done);
        seam.addEventListener('pointercancel', done);
        seam.addEventListener('lostpointercapture', done);

        try {
            var saved = parseFloat(window.localStorage.getItem('billiards.split'));
            if (saved) setSplit(saved);
        } catch (err) { /* first time here */ }
    }

    function setSplit(ratio) {
        state.split = view.setSplit(ratio);
    }

    /** A touch anywhere means thumbs, not a mouse: show the bigger controls. */
    function markTouch() {
        document.body.classList.add('touch');
        drawSpinWidget();          // the dial is bigger in that layout
    }

    window.addEventListener('load', function () {
        if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) markTouch();
        window.addEventListener('pointerdown', function (e) {
            if (e.pointerType === 'touch') markTouch();
        }, true);

        if (!newGame()) return;            // no WebGL: the banner says so
        if (!checkVersions()) return;      // nothing below would work anyway
        initPanels();
        initSeam();

        var canvas = document.getElementById('scene');
        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);

        // spin dial: drag the tip around the cue ball
        var spin = document.getElementById('spin');
        var spinning = false;
        spin.addEventListener('pointerdown', function (e) {
            if (!humanTurn()) return;
            e.preventDefault();
            spinning = true;
            capture(spin, e.pointerId);
            spinFromPointer(e);
        });
        spin.addEventListener('pointermove', function (e) {
            if (spinning) spinFromPointer(e);
        });
        function endSpin() { spinning = false; }
        spin.addEventListener('pointerup', endSpin);
        spin.addEventListener('pointercancel', endSpin);
        spin.addEventListener('lostpointercapture', endSpin);
        spin.addEventListener('dblclick', function () {
            state.side = state.vert = 0;
            drawSpinWidget();
        });

        // hold to charge, let go to shoot - the same deal as the mouse button
        holdButton(document.getElementById('shoot'),
            function (e) { startCharge(e.pointerId); },
            function (e) { releaseCharge(e.pointerId); });

        holdButton(document.getElementById('aimleft'), function () { startNudge(-1); }, stopNudge);
        holdButton(document.getElementById('aimright'), function () { startNudge(1); }, stopNudge);

        var elev = document.getElementById('elev');
        elev.addEventListener('input', function () {
            if (humanTurn()) setElevation(+this.value);
            else this.value = state.elevation;      // put the slider back
        });
        elev.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        setElevation(0);

        document.getElementById('newgame').addEventListener('click', newGame);
        document.getElementById('swap').addEventListener('click', function () { view.swapViews(); });
        var panel = document.getElementById('status');
        if (panel) {
            panel.addEventListener('click', function (e) {
                var seat = e.target.closest && e.target.closest('.seat');
                if (!seat) return;
                askSeat(+seat.getAttribute('data-seat'));
                e.stopPropagation();
            });
        }

        var ai = document.getElementById('ai');
        if (ai) {
            ai.addEventListener('click', function () { askHint(); this.blur(); });
        }
        document.getElementById('dock').addEventListener('click', function () {
            Panels.resetAll();      // every panel back into its band
            this.blur();
        });
        document.getElementById('sound').addEventListener('click', function () {
            this.innerHTML = Sound.toggle() ? '\u266a' : '\u266a\u0338';
            this.blur();
        });

        window.addEventListener('resize', drawSpinWidget);
        window.addEventListener('orientationchange', function () {
            window.setTimeout(drawSpinWidget, 250);
        });

        window.requestAnimationFrame(frame);
    });

    /* ------------------------------------------------------------------ *
     * the driver surface
     *
     * For something operating the game from outside: an agent in a terminal,
     * or a person at the console. It speaks the units the brief speaks -
     * centimetres, and a power from 0 to 1 - and it answers in sentences,
     * because what reads it next is as likely to be a language model as a
     * program.
     *
     * Its shots go through takeShot, the same path the network's take, so a
     * driven shot lines up and draws back where it can be watched. A shot
     * nobody saw being chosen is not worth putting on a screen.
     * ------------------------------------------------------------------ */

    var SETTLE_LIMIT = 60000;        // a shot that has not finished by now never will

    var watchers = [];

    /**
     * A promise for something the table has not done yet. `ready` is asked on
     * every frame and answers null until it has something to say.
     */
    function waitFor(ready, limit, key) {
        var deadline = limit ? performance.now() + limit : 0;
        var answer = ready();
        if (answer !== null && answer !== undefined) return Promise.resolve(answer);

        // A driver that gave up on a wait and asked again would otherwise leave
        // the first one here for good, polled on every frame and answered to
        // nobody. Asking again replaces the question.
        if (key) {
            watchers = watchers.filter(function (w) {
                if (w.key !== key) return true;
                w.resolve('Superseded by a later wait on the same seat.');
                return false;
            });
        }
        return new Promise(function (resolve) {
            watchers.push({ready: ready, resolve: resolve, deadline: deadline, key: key});
        });
    }

    function pumpWatchers(now) {
        for (var i = watchers.length - 1; i >= 0; i--) {
            var w = watchers[i];
            var answer = w.ready();
            if (answer === null || answer === undefined) {
                if (!w.deadline || now < w.deadline) continue;
                answer = 'Timed out waiting for the table to settle.';
            }
            watchers.splice(i, 1);
            w.resolve(answer);
        }
    }

    /** True once the table has finished with whatever it was given. */
    function settled() {
        return state.phase !== 'rolling' && state.phase !== 'charging' && !state.lining;
    }

    function spot(ball) {
        return Math.round(ball.x * 100) + ',' + Math.round(ball.y * 100);
    }

    /**
     * What the shot did, for whoever played it. The rulebook has already
     * written the sentence that matters, so this adds only what it leaves out:
     * which balls went down when the message does not name them, and where the
     * cue ball came to rest, which is the thing the shot was really steering.
     */
    function outcome(before) {
        if (state.phase === 'over') return 'Game over. ' + state.message;

        var dropped = state.pocketed.filter(function (id) {
            return before.indexOf(id) < 0;
        });
        var said = [state.message];

        // The rulebook names the balls itself when they were the shooter's own.
        // It does not when the shot fouled or dropped one of the opponent's,
        // and those are the times it is worth knowing what went in.
        if (dropped.length && !/^Potted \d/.test(state.message)) {
            said.push('Down this shot: ' + dropped.join(', ') + '.');
        }
        said.push(state.phase === 'ballInHand'
            ? 'Cue ball is in hand.'
            : 'Cue ball finished at ' + spot(cueBall) + '.');
        said.push('Player ' + (state.player + 1) + ' to play.');
        return said.join(' ');
    }

    /**
     * Line a shot up and hand back a promise for what it does. Power arrives
     * as a fraction of what the cue can give, so a driver never has to know
     * what the table's units are.
     */
    function launch(angle, power, side, vert, chosen) {
        if (state.seats[state.player] === 'human') setSeat(state.player, 'driver');
        var before = state.pocketed.slice();

        takeShot({
            angle: angle,
            power: MIN_POWER + Phys.clamp(power, 0, 1) * (MAX_POWER - MIN_POWER),
            side: Phys.clamp(side || 0, -1, 1),
            vert: Phys.clamp(vert || 0, -1, 1),
            elevation: 0
        }, chosen);

        return waitFor(function () {
            return settled() ? outcome(before) : null;
        }, SETTLE_LIMIT);
    }

    /**
     * The reason this seat cannot shoot right now, or null if it can. `seat` is
     * optional, and worth passing when two drivers share a table: it is what
     * stops one of them moving on the other's turn.
     */
    function cannotShoot(seat) {
        if (state.phase === 'over') return 'Game over. ' + state.message;
        if (state.phase === 'rolling') return 'The balls are still rolling.';
        if (state.lining) return 'A shot is already lined up.';
        if (seat !== undefined && seat !== state.player + 1) {
            return 'Player ' + (state.player + 1) + ' to play, not you.';
        }
        if (state.phase === 'ballInHand') {
            return 'Cue ball in hand: place it with placeCue(x, y) before shooting.';
        }
        return null;
    }

    /** The pots on offer, in the order the brief just numbered them. */
    function shortlist() {
        return Geometry.candidates(world,
            Rules.legalBalls(world, state.groups, state.player));
    }

    /**
     * The position in words. `seat` is 1 or 2 and optional: pass it and you
     * are told plainly when it is not your turn, which is what a driver
     * polling for its go needs to hear.
     */
    function briefFor(seat) {
        if (state.phase === 'over') return 'Game over. ' + state.message;
        if (state.phase === 'rolling') return 'The balls are still rolling.';
        if (seat !== undefined && seat !== state.player + 1) {
            return 'Player ' + (state.player + 1) + ' to play, not you.';
        }
        return Brief.describe(world, {
            player: state.player,
            groups: state.groups,
            open: state.open,
            broken: state.broken,
            ballInHand: state.phase === 'ballInHand',
            kitchenOnly: state.kitchenOnly
        });
    }

    window.Billiards = {
        state: state,
        world: function () { return world; },
        newGame: newGame,
        /** The position in words, for a driver that reads rather than looks. */
        brief: briefFor,

        /**
         * Take one of the pots the brief numbered.
         *
         * @param {number} n      which pot, counting from 1 as the brief prints it
         * @param {number} power  0 for the softest roll the cue can give, 1 for
         *     everything it has
         * @param {number} side   left or right english, -1 to 1
         * @param {number} vert   draw to follow, -1 to 1
         * @param {number=} seat  your seat, 1 or 2. Optional, and worth passing
         *     when two drivers share a table: it refuses the shot rather than
         *     playing it for your opponent.
         * @return {Promise<string>} what the shot did, once the table is still
         */
        play: function (n, power, side, vert, seat) {
            var no = cannotShoot(seat);
            if (no) return Promise.resolve(no);

            var on = shortlist();
            var pick = on[n - 1];
            if (!pick) {
                return Promise.resolve(on.length
                    ? 'There is no shot ' + n + ': the list runs 1 to ' + on.length + '.'
                    : 'No pot is on, so there is nothing to pick. Play safe with ' +
                      'aim(x, y, power) instead.');
            }
            return launch(pick.angle, power, side, vert, pick);
        },

        /**
         * Shoot at a point on the cloth rather than at a numbered pot: the
         * safety shots, the escapes, and anything the shortlist does not hold.
         * Coordinates are in cm, as the brief gives them.
         *
         * @return {Promise<string>} what the shot did, once the table is still
         */
        aim: function (x, y, power, side, vert, seat) {
            var no = cannotShoot(seat);
            if (no) return Promise.resolve(no);
            return launch(
                Math.atan2(y / 100 - cueBall.y, x / 100 - cueBall.x),
                power, side, vert, null);
        },

        /**
         * Put the cue ball down, in cm. Only legal while it is in hand, which
         * the brief says when it is.
         */
        placeCue: function (x, y, seat) {
            if (seat !== undefined && seat !== state.player + 1) {
                return 'Player ' + (state.player + 1) + ' to play, not you.';
            }
            if (state.phase !== 'ballInHand') return 'The cue ball is not in hand.';
            if (!placeCueBall(x / 100, y / 100)) {
                return 'Not a legal spot: it has to be clear of the rails and of ' +
                    'every other ball' +
                    (state.kitchenOnly ? ', and behind the head string.' : '.');
            }
            if (state.seats[state.player] === 'human') setSeat(state.player, 'driver');
            return 'Cue ball placed at ' + spot(cueBall) + '.';
        },

        /**
         * Wait until it is this seat's turn, and hand back the position when it
         * is. Seats are 1 and 2. Resolves straight away if it is already your
         * go, and resolves rather than hanging once the game is over.
         *
         * @return {Promise<string>} the brief, ready to act on
         */
        awaitTurn: function (seat) {
            if (state.seats[seat - 1] === 'human') setSeat(seat - 1, 'driver');
            return waitFor(function () {
                if (state.phase === 'over') return 'Game over. ' + state.message;
                if (!settled() || state.player + 1 !== seat) return null;
                return briefFor(seat);
            }, 0, 'turn' + seat);
        },
        place: function (x, y) { return state.phase === 'ballInHand' && placeCueBall(x, y); },
        aimAt: function (x, y) { aimAt({x: x, y: y}); return state.angle; },
        shoot: function (power, side, vert, elevation) {
            if (state.phase !== 'aiming') return false;
            state.power = Phys.clamp(power, MIN_POWER, MAX_POWER);
            state.side = side || 0;
            state.vert = vert || 0;
            if (elevation !== undefined) setElevation(elevation);
            shoot();
            return true;
        },
        elevate: function (deg) { setElevation(deg); return state.elevation; },
        views: function () { return rects; },      // the two pane rectangles
        slowMotion: function (scale) {
            state.timeScale = Phys.clamp(scale, 0.05, 1);
            return state.timeScale;
        }
    };
})();
