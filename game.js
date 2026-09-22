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
        message: 'Break them up: place the cue ball behind the line and fire.',
        pocketed: [],
        ghost: null,                // cue ball position while placing it
        insetPos: null              // where the inset was dragged to, if anywhere
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
        if (!world) {
            buildWorld();
            view = new Renderer(document.getElementById('scene'), world);
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
        state.pocketed = [];
        state.message = 'Break them up: place the cue ball behind the line and fire.';
        state.ghost = null;

        drawSpinWidget();
        updateHud();
    }

    /* ------------------------------------------------------------------ *
     * rules
     * ------------------------------------------------------------------ */

    function groupOf(id) {
        if (id === 0 || id === 8) return null;
        return id < 8 ? 'solids' : 'stripes';
    }

    function remaining(group) {
        var left = 0;
        world.balls.forEach(function (b) {
            if (b.active && groupOf(b.id) === group) left++;
        });
        return left;
    }

    function legalTarget() {
        var group = state.groups[state.player];
        if (!group) return null;                       // table open: anything but the 8
        return remaining(group) === 0 ? 'eight' : group;
    }

    function shoot() {
        // the legal target has to be read now: by the time the shot is judged,
        // the ball it was aimed at may already be off the table
        shot = {
            first: null, potted: [], rail: false,
            breakShot: !state.broken, target: legalTarget()
        };
        world.strike(cueBall, Math.cos(state.angle), Math.sin(state.angle),
            state.power, state.side, state.vert);
        state.phase = 'rolling';
        state.broken = true;
        Sound.hit(state.power / MAX_POWER);
        updatePowerBar();      // empty the shoot button now, not on the next frame
    }

    function trackEvents(events) {
        events.forEach(function (e) {
            if (e.type === 'ballHit') {
                if (shot && shot.first === null && (e.a.id === 0 || e.b.id === 0)) {
                    shot.first = (e.a.id === 0 ? e.b.id : e.a.id);
                }
                Sound.click(e.speed);
            } else if (e.type === 'cushion') {
                if (shot && shot.first !== null) shot.rail = true;
                Sound.cushion(e.speed);
            } else if (e.type === 'pot') {
                if (shot) shot.potted.push(e.ball.id);
                if (e.ball.id !== 0) state.pocketed.push(e.ball.id);
                Sound.pot();
            }
        });
    }

    /** Work out what the shot just achieved, and who is up next. */
    function resolveShot() {
        var player = state.player;
        var potted = shot.potted;
        var scratch = potted.indexOf(0) >= 0;
        var eight = potted.indexOf(8) >= 0;
        var objects = potted.filter(function (id) { return id !== 0 && id !== 8; });
        var target = shot.target;

        var foul = null;

        if (shot.first === null) {
            foul = 'No contact with any ball.';
        } else if (target === 'eight' && shot.first !== 8) {
            foul = 'You are on the 8 ball and hit the ' + shot.first + ' first.';
        } else if (target && target !== 'eight' && groupOf(shot.first) !== target) {
            foul = 'Wrong ball first: you are on ' + target + '.';
        } else if (!target && shot.first === 8 && !shot.breakShot) {
            foul = 'The table is open but the 8 ball is never a legal first hit.';
        }

        if (!foul && potted.length === 0 && !shot.rail) {
            foul = 'No ball potted and nothing reached a cushion.';
        }
        if (scratch) foul = foul || 'Scratch - the cue ball went down.';

        // the 8 ball on the break is nobody's fault: spot it and play on
        if (eight && shot.breakShot) {
            respot(world.ball(8));
            var idx = state.pocketed.indexOf(8);
            if (idx >= 0) state.pocketed.splice(idx, 1);
            eight = false;
            potted = potted.filter(function (id) { return id !== 8; });
        }

        // otherwise the 8 ball ends the game one way or the other
        if (eight) {
            var cleared = state.groups[player] && remaining(state.groups[player]) === 0;
            if (cleared && !foul && !scratch) {
                endGame(player, 'potted the 8 ball to win');
            } else {
                endGame(1 - player, 'wins: the 8 ball went down early');
            }
            return;
        }

        // first legal pot off the break decides who owns what
        if (state.open && !foul && objects.length && !shot.breakShot) {
            var group = groupOf(objects[0]);
            state.groups[player] = group;
            state.groups[1 - player] = group === 'solids' ? 'stripes' : 'solids';
            state.open = false;
        }



        var mine = objects.filter(function (id) {
            return !state.groups[player] || groupOf(id) === state.groups[player];
        });

        if (foul) {
            state.player = 1 - player;
            // after a bad break the incoming player is still stuck behind the line
            takeBallInHand(shot.breakShot);
            state.message = foul + ' Ball in hand for player ' + (state.player + 1) + '.';
        } else if (mine.length) {
            state.phase = 'aiming';
            state.message = 'Potted ' + mine.join(', ') + '. Same player again.';
        } else {
            state.player = 1 - player;
            state.phase = 'aiming';
            state.message = objects.length
                ? 'Potted your opponent’s ball. Turn passes.'
                : 'Nothing dropped. Player ' + (state.player + 1) + ' to shoot.';
        }

        state.power = 0;
    }

    /** Put a ball back on the foot spot, or as close behind it as there is room. */
    function respot(ball) {
        var r = world.radius;
        for (var x = TABLE_W * 0.75; x < TABLE_W - 2 * r; x += r * 0.5) {
            var clear = world.balls.every(function (b) {
                return !b.active || b === ball ||
                    Math.hypot(b.x - x, b.y - TABLE_H / 2) > 2.05 * r;
            });
            if (clear) {
                ball.placeAt(x, TABLE_H / 2);
                return;
            }
        }
        ball.placeAt(TABLE_W * 0.75, TABLE_H / 2);
    }

    function endGame(winner, why) {
        state.phase = 'over';
        state.message = 'Player ' + (winner + 1) + ' ' + why + '. Press R for a new rack.';
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
        var r = world.radius;
        if (x < r * 1.2 || x > TABLE_W - r * 1.2 || y < r * 1.2 || y > TABLE_H - r * 1.2) return false;
        if (state.kitchenOnly && x > TABLE_W * 0.25) return false;

        for (var i = 0; i < world.balls.length; i++) {
            var b = world.balls[i];
            if (!b.active || b.id === 0) continue;
            var dx = b.x - x, dy = b.y - y;
            if (dx * dx + dy * dy < (2.05 * r) * (2.05 * r)) return false;
        }
        return true;
    }

    function placeCueBall(x, y) {
        if (!placementLegal(x, y)) return false;
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

    /** True if the pointer is over the small inset view rather than the table. */
    function insetHit(e) {
        if (!rects) return false;
        var box = document.getElementById('scene').getBoundingClientRect();
        var r = view.isSwapped() ? rects.table : rects.pov;
        var x = e.clientX - box.left, y = e.clientY - box.top;
        return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    }

    function onPointerDown(e) {
        if (insetHit(e)) {          // tap the small view to bring it up front
            view.swapViews();
            return;
        }

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
        if (state.phase !== 'aiming') return;
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

    function onKeyDown(e) {
        if (e.repeat && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
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
            case 'KeyV':
                view.swapViews();
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
            var html = '<b>Player ' + (p + 1) + '</b> <span class="grp">' + groupLabel(p) + '</span> ';
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
        var key = state.player + '|' + state.phase + '|' + state.message;
        if (key === hudShown) return;
        hudShown = key;
        updateHud();
    }

    function updatePowerBar() {
        var pct = Math.max(0, Math.round(100 * (state.power - MIN_POWER) / (MAX_POWER - MIN_POWER)));
        document.getElementById('powerfill').style.width = pct + '%';

        // the shoot button fills up as it is held, so a thumb over the bar
        // still knows how hard the shot is going to be
        document.getElementById('shootfill').style.height =
            (state.phase === 'charging' ? pct : 0) + '%';

        var shoot = document.getElementById('shoot');
        shoot.disabled = !(state.phase === 'aiming' || state.phase === 'charging');
    }

    /**
     * Keep the inset view clear of the panels: below the buttons on a touch
     * layout, where the controls own the bottom of the screen, and above the
     * controls otherwise.
     */
    /**
     * Reserve table space only for panels still parked against an edge and wide
     * enough to matter. Drag one into the middle of the screen and it simply
     * floats over the cloth - that was the point of moving it.
     */
    function dockedInsets() {
        var insets = {top: 0, bottom: 0, left: 0, right: 0};
        var w = window.innerWidth, h = window.innerHeight;

        ['status', 'buttons', 'controls'].forEach(function (id) {
            var r = document.getElementById(id).getBoundingClientRect();
            if (r.width < w * 0.6) return;                 // narrow panels just overlay
            if (h - r.bottom < 40) insets.bottom = Math.max(insets.bottom, h - r.top + 10);
            else if (r.top < 40) insets.top = Math.max(insets.top, r.bottom + 10);
        });
        return insets;
    }

    function placeInset() {
        if (state.insetPos) {
            view.setInsetPosition(state.insetPos.x, state.insetPos.y);
        } else {
            view.setInsetPosition(null);
            if (document.body.classList.contains('touch')) {
                var bar = document.getElementById('buttons').getBoundingClientRect();
                view.setInsetPlacement('top', bar.bottom + 10);
            } else {
                var controls = document.getElementById('controls').getBoundingClientRect();
                view.setInsetPlacement('bottom', window.innerWidth < 900
                    ? Math.max(0, window.innerHeight - controls.top) + 10 : 0);
            }
        }
        view.setTableInsets(dockedInsets());
    }

    function positionInsetFrame() {
        if (!rects) return;
        var frame = document.getElementById('insetframe');
        var r = view.isSwapped() ? rects.table : rects.pov;
        frame.style.left = r.x + 'px';
        frame.style.top = r.y + 'px';
        frame.style.width = r.w + 'px';
        frame.style.height = r.h + 'px';
        document.getElementById('insetlabel').textContent =
            view.isSwapped() ? 'TABLE' : 'CUE BALL POV';
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

    function frame(now) {
        var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
        last = now;

        sweepAim(now);

        if (state.phase === 'charging') state.power = chargedPower(now);

        if (dt > 0) {
            trackEvents(world.step(dt));
            if (state.phase === 'rolling' && world.atRest()) {
                resolveShot();
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

        placeInset();
        view.syncBalls();

        var aiming = state.phase === 'aiming' || state.phase === 'charging';
        view.setAim(aiming ? {
            ball: cueBall, angle: state.angle, power: state.power,
            side: state.side, vert: state.vert
        } : null);

        refreshHud();
        rects = view.render(cueBall, state.angle);
        positionInsetFrame();
        updatePowerBar();

        document.getElementById('scene').style.cursor =
            (state.phase === 'ballInHand' && state.ghost && !placementLegal(state.ghost.x, state.ghost.y))
                ? 'not-allowed' : 'crosshair';

        window.requestAnimationFrame(frame);
    }

    /* ------------------------------------------------------------------ */

    /** Every panel can be dragged clear of the shot, the inset included. */
    function initPanels() {
        Panels.register(document.getElementById('status'), 'status');
        Panels.register(document.getElementById('buttons'), 'buttons');
        Panels.register(document.getElementById('controls'), 'controls');
        Panels.register(document.getElementById('insetframe'), 'inset', {
            onMove: function (x, y) {
                var box = document.getElementById('scene').getBoundingClientRect();
                state.insetPos = {x: x - box.left, y: y - box.top};
            },
            onReset: function () { state.insetPos = null; },
            onTap: function () { view.swapViews(); }    // a tap still brings it up front
        });
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

        newGame();
        initPanels();

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

        document.getElementById('newgame').addEventListener('click', newGame);
        document.getElementById('swap').addEventListener('click', function () { view.swapViews(); });
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

    // Small control surface, handy from the console and used by the headless
    // tests to play whole games without a mouse.
    window.Billiards = {
        state: state,
        world: function () { return world; },
        newGame: newGame,
        place: function (x, y) { return state.phase === 'ballInHand' && placeCueBall(x, y); },
        aimAt: function (x, y) { aimAt({x: x, y: y}); return state.angle; },
        shoot: function (power, side, vert) {
            if (state.phase !== 'aiming') return false;
            state.power = Phys.clamp(power, MIN_POWER, MAX_POWER);
            state.side = side || 0;
            state.vert = vert || 0;
            shoot();
            return true;
        }
    };
})();
