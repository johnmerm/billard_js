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
        ghost: null                 // cue ball position while placing it
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
        state.ghost = {x: TABLE_W * 0.22, y: TABLE_H / 2};

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

        if (scratch) {
            // bring the cue ball back out of the pocket; it is placed by hand next
            cueBall.placeAt(TABLE_W * 0.25, TABLE_H / 2);
        }

        var mine = objects.filter(function (id) {
            return !state.groups[player] || groupOf(id) === state.groups[player];
        });

        if (foul) {
            state.player = 1 - player;
            state.phase = 'ballInHand';
            // after a bad break the incoming player is still stuck behind the line
            state.kitchenOnly = shot.breakShot;
            state.ghost = {x: TABLE_W * 0.25, y: TABLE_H / 2};
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

    function onPointerMove(e) {
        var p = pointerPos(e);
        if (!p) return;
        if (state.phase === 'ballInHand') {
            state.ghost = p;
        } else if (state.phase === 'aiming') {
            aimAt(p);
        }
    }

    function onPointerDown(e) {
        var p = pointerPos(e);
        if (state.phase === 'ballInHand') {
            if (p) placeCueBall(p.x, p.y);
            return;
        }
        if (state.phase !== 'aiming') return;
        if (p) aimAt(p);
        startCharge();
    }

    function startCharge() {
        if (state.phase !== 'aiming') return;
        state.phase = 'charging';
        state.chargeStart = performance.now();
        state.power = MIN_POWER;
    }

    function releaseCharge() {
        if (state.phase !== 'charging') return;
        shoot();
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
        }
    }

    function onKeyUp(e) {
        if (e.code === 'Space') releaseCharge();
    }

    /** The little cue ball dial that sets where the tip strikes. */
    function drawSpinWidget() {
        var cv = document.getElementById('spin');
        if (!cv) return;
        var ctx = cv.getContext('2d');
        var size = cv.width, c = size / 2, rad = size / 2 - 4;

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
        var rad = box.width / 2 - 4;
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

    function updatePowerBar() {
        var pct = Math.round(100 * (state.power - MIN_POWER) / (MAX_POWER - MIN_POWER));
        document.getElementById('powerfill').style.width = Math.max(0, pct) + '%';
    }

    function positionInsetFrame() {
        if (!rects) return;
        var frame = document.getElementById('insetframe');
        var r = view.isSwapped() ? rects.table : rects.pov;
        frame.style.left = r.x + 'px';
        frame.style.top = r.y + 'px';
        frame.style.width = r.w + 'px';
        frame.style.height = r.h + 'px';
        frame.textContent = view.isSwapped() ? 'TABLE' : 'CUE BALL POV';
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

        if (state.phase === 'charging') {
            var held = (now - state.chargeStart) / 1000;
            var t = Math.min(held / CHARGE_TIME, 1);
            state.power = MIN_POWER + (MAX_POWER - MIN_POWER) * t;
        }

        if (dt > 0) {
            trackEvents(world.step(dt));
            if (state.phase === 'rolling' && world.atRest()) {
                resolveShot();
                updateHud();
            }
        }

        // the cue ball floats under the cursor while it is in hand
        if (state.phase === 'ballInHand' && state.ghost) {
            cueBall.placeAt(state.ghost.x, state.ghost.y);
        }

        // on a narrow screen the controls sit under the inset, so lift it clear
        var controls = document.getElementById('controls').getBoundingClientRect();
        view.setInsetLift(window.innerWidth < 900 ? controls.height + 10 : 0);

        view.syncBalls();

        var aiming = state.phase === 'aiming' || state.phase === 'charging';
        view.setAim(aiming ? {
            ball: cueBall, angle: state.angle, power: state.power,
            side: state.side, vert: state.vert
        } : null);

        rects = view.render(cueBall, state.angle);
        positionInsetFrame();
        updatePowerBar();

        document.getElementById('scene').style.cursor =
            (state.phase === 'ballInHand' && state.ghost && !placementLegal(state.ghost.x, state.ghost.y))
                ? 'not-allowed' : 'crosshair';

        window.requestAnimationFrame(frame);
    }

    /* ------------------------------------------------------------------ */

    window.addEventListener('load', function () {
        newGame();

        var canvas = document.getElementById('scene');
        canvas.addEventListener('mousemove', onPointerMove);
        canvas.addEventListener('mousedown', onPointerDown);
        window.addEventListener('mouseup', releaseCharge);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);

        var spin = document.getElementById('spin');
        var spinning = false;
        spin.addEventListener('mousedown', function (e) { spinning = true; spinFromPointer(e); e.preventDefault(); });
        window.addEventListener('mousemove', function (e) { if (spinning) spinFromPointer(e); });
        window.addEventListener('mouseup', function () { spinning = false; });

        document.getElementById('newgame').addEventListener('click', newGame);
        document.getElementById('swap').addEventListener('click', function () { view.swapViews(); });

        // touch: drag to aim, lift to shoot
        canvas.addEventListener('touchstart', function (e) {
            var t = e.touches[0];
            onPointerDown({clientX: t.clientX, clientY: t.clientY});
            e.preventDefault();
        }, {passive: false});
        canvas.addEventListener('touchmove', function (e) {
            var t = e.touches[0];
            onPointerMove({clientX: t.clientX, clientY: t.clientY});
            e.preventDefault();
        }, {passive: false});
        canvas.addEventListener('touchend', function (e) { releaseCharge(); e.preventDefault(); }, {passive: false});

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
