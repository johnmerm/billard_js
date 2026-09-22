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
        split: 0.62                 // how much of the screen the upper view gets
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
            try {
                view = new Renderer(document.getElementById('scene'), world);
            } catch (err) {
                noWebGL(err);
                return false;
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
            state.power, state.side, state.vert, state.elevation * Math.PI / 180);
        state.phase = 'rolling';
        state.broken = true;
        setElevation(0);            // the cue goes back down for the next shot
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
            case 'BracketLeft':
                setElevation(state.elevation - (e.shiftKey ? 1 : 5));
                break;
            case 'BracketRight':
                setElevation(state.elevation + (e.shiftKey ? 1 : 5));
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

        var bar = document.getElementById('powerfill');
        if (bar) bar.style.width = pct + '%';

        // the shoot button fills up as it is held, so a thumb over the bar
        // still knows how hard the shot is going to be
        var fill = document.getElementById('shootfill');
        if (fill) fill.style.height = (state.phase === 'charging' ? pct : 0) + '%';

        var shoot = document.getElementById('shoot');
        if (shoot) shoot.disabled = !(state.phase === 'aiming' || state.phase === 'charging');
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
        dt *= state.timeScale;      // 1 is real time; lower runs the table slowly

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
     * Without WebGL there is nothing to draw into. That is a browser setting or
     * a driver, not something this page can work around, so say what happened
     * and what usually fixes it rather than leaving a blank window.
     */
    function noWebGL(err) {
        var banner = document.createElement('div');
        banner.id = 'stale';
        banner.innerHTML =
            '<b>This browser could not start WebGL</b>, so the table cannot be drawn.<br><br>' +
            'It is usually turned off rather than missing: look at <b>chrome://gpu</b>, ' +
            'switch on <i>use hardware acceleration when available</i> in the browser\u2019s ' +
            'settings, or try another browser.<br><br>' +
            '<span style="opacity:0.7">' + (err && err.message ? err.message : err) + '</span>';
        document.body.appendChild(banner);
        if (window.console) window.console.error('billiards: no WebGL context', err);
    }

    /**
     * The page and its scripts have to be the same vintage. A browser or a cdn
     * that pairs a fresh index.html with a stale render.js leaves a blank canvas
     * and a console message nobody reads, so say it on the page instead.
     */
    function checkVersions() {
        var needed = ['render', 'syncBalls', 'setAim', 'setInHand', 'setSplit',
            'setPaneRegion', 'swapViews', 'screenToTable'];
        var missing = needed.filter(function (name) {
            return typeof view[name] !== 'function';
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
        elev.addEventListener('input', function () { setElevation(+this.value); });
        elev.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        setElevation(0);

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
