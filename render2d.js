/**
 * render2d.js - draws a Phys world with a plain 2d canvas.
 *
 * A stand-in for render.js on machines where WebGL will not start: the browser
 * has hardware acceleration switched off, the driver is blocklisted, or Chrome
 * has stopped falling back to software WebGL on its own. The physics, the rules
 * and every control are the same; only the picture is simpler.
 *
 * Both views are here, in the same two panes render.js lays out. The table view
 * is a flat plan: table coordinates mapped to css pixels by `sx`/`sy`, a mapping
 * that only ever swaps and flips axes, so a table rectangle stays an axis
 * aligned rectangle on screen whichever way round the table is standing.
 *
 * The cue ball's view is a pinhole camera sitting in the white ball, written out
 * by hand: `toCam` puts a point in the camera's frame, `project` divides by the
 * depth, and `fillPoly3` clips a polygon against the near plane before filling
 * it - without that a quad with a corner behind the camera turns inside out. The
 * cloth, the rails and the balls are drawn back to front, which is all the depth
 * sorting a table needs: the balls never get behind a cushion.
 */
function Renderer2D(canvas, world) {
    'use strict';

    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Renderer2D: this browser has no 2d canvas either');

    var R = world.radius, W = world.width, H = world.height;

    var CUSHION_D = R * 1.6;     // how deep the rubber sits
    var FRAME = R * 3.4;         // wooden surround, outside the cushions
    var MARGIN = FRAME + R * 2;  // table plus surround, the box that has to fit

    var BACK = '#0a0d10';
    var CLOTH = '#15754a';
    var RUBBER = '#0a4229';
    var WOOD = '#5a3320';

    var aim = null;              // what setAim was last given
    var hand = null;             // what setInHand was last given
    var region = {top: 0, bottom: 0};
    var splitRatio = 0.62;       // how much of the free space the upper pane gets
    var swapped = false;         // false: table on top, cue ball view below
    var portrait = false;

    /* ------------------------- table to screen ------------------------ */

    // sx = a*x + c*y + e, sy = b*x + d*y + f, in css pixels
    var a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;
    var scale = 1;               // css pixels per metre

    function fit(rect) {
        portrait = rect.h > rect.w;

        var across = (portrait ? H : W) + 2 * MARGIN;
        var up = (portrait ? W : H) + 2 * MARGIN;
        scale = Math.min(rect.w / across, rect.h / up);

        var cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
        if (portrait) {
            // standing on end: screen up is table +x, screen left is table +y,
            // the same way round as the three.js view
            a = 0; b = -scale; c = -scale; d = 0;
            e = cx + scale * H / 2;
            f = cy + scale * W / 2;
        } else {
            a = scale; b = 0; c = 0; d = -scale;
            e = cx - scale * W / 2;
            f = cy + scale * H / 2;
        }
    }

    function sx(x, y) { return a * x + c * y + e; }
    function sy(x, y) { return b * x + d * y + f; }

    /** A direction in table coordinates, as a direction on screen. */
    function dx2(ux, uy) { return a * ux + c * uy; }
    function dy2(ux, uy) { return b * ux + d * uy; }

    /** Screen box of a table rectangle: axis aligned whichever way round. */
    function boxOf(x1, y1, x2, y2) {
        var ax = sx(x1, y1), ay = sy(x1, y1);
        var bx = sx(x2, y2), by = sy(x2, y2);
        return {
            x: Math.min(ax, bx), y: Math.min(ay, by),
            w: Math.abs(bx - ax), h: Math.abs(by - ay)
        };
    }

    function fillBox(x1, y1, x2, y2, colour, radius) {
        var r = boxOf(x1, y1, x2, y2);
        ctx.fillStyle = colour;
        ctx.beginPath();
        if (radius && ctx.roundRect) ctx.roundRect(r.x, r.y, r.w, r.h, radius);
        else ctx.rect(r.x, r.y, r.w, r.h);
        ctx.fill();
    }

    function disc(x, y, radius, colour) {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }

    function line(x1, y1, x2, y2, colour, width, alpha) {
        ctx.save();
        ctx.globalAlpha = alpha === undefined ? 1 : alpha;
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(sx(x1, y1), sy(x1, y1));
        ctx.lineTo(sx(x2, y2), sy(x2, y2));
        ctx.stroke();
        ctx.restore();
    }

    /* ---------------------------- furniture --------------------------- */

    function drawTable() {
        // wooden surround, then the cloth laid inside it
        var out = CUSHION_D + FRAME;
        fillBox(-out, -out, W + out, H + out, WOOD, Math.max(4, FRAME * scale * 0.5));
        fillBox(-CUSHION_D, -CUSHION_D, W + CUSHION_D, H + CUSHION_D, CLOTH, 0);

        // cushions, straight off the physics segments so the jaw cuts show
        ctx.fillStyle = RUBBER;
        world.cushions.forEach(function (seg) {
            if (seg.restitution !== undefined && seg.restitution < 0.3) return;

            var ang = Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1);
            var nx = Math.sin(ang), ny = -Math.cos(ang);
            // push the body of the cushion away from the playing surface
            if (nx * (W / 2 - (seg.x1 + seg.x2) / 2) +
                ny * (H / 2 - (seg.y1 + seg.y2) / 2) > 0) { nx = -nx; ny = -ny; }

            var ox = nx * CUSHION_D, oy = ny * CUSHION_D;
            ctx.beginPath();
            ctx.moveTo(sx(seg.x1, seg.y1), sy(seg.x1, seg.y1));
            ctx.lineTo(sx(seg.x2, seg.y2), sy(seg.x2, seg.y2));
            ctx.lineTo(sx(seg.x2 + ox, seg.y2 + oy), sy(seg.x2 + ox, seg.y2 + oy));
            ctx.lineTo(sx(seg.x1 + ox, seg.y1 + oy), sy(seg.x1 + ox, seg.y1 + oy));
            ctx.closePath();
            ctx.fill();
        });

        // the rounded mouth a player recognises, and the square the cloth is
        // actually cut to, so nothing falls through what looks like cloth
        world.pockets.forEach(function (p) {
            disc(sx(p.x, p.y), sy(p.x, p.y), p.radius * 1.05 * scale, '#07090b');
        });
        (world.pocketCuts || []).forEach(function (c) {
            fillBox(c.x1, c.y1, c.x2, c.y2, '#07090b', 0);
        });

        // head string and foot spot, the markings you aim off
        line(W * 0.25, 0, W * 0.25, H, '#bfd8c6', Math.max(1, scale * 0.004), 0.35);
        ctx.globalAlpha = 0.5;
        disc(sx(W * 0.75, H / 2), sy(W * 0.75, H / 2), R * 0.22 * scale, '#cfe4d5');
        ctx.globalAlpha = 1;
    }

    /* ------------------------------ balls ----------------------------- */

    function drawBall(ball) {
        if (!ball.active) return;

        var lift = Math.max(0, ball.height - R);

        // Straight down, height does not show at all, so a jumping ball would
        // slide over another one and look like a bug. Its shadow gives it away:
        // it slides out from under the ball, spreads and fades as it climbs.
        if (ball.height > -R) {
            var off = R * 0.12 + lift * 0.45;
            ctx.save();
            ctx.globalAlpha = 0.32 / (1 + lift * 14);
            disc(sx(ball.x + off, ball.y - off), sy(ball.x + off, ball.y - off),
                R * 0.92 * scale * (1 + lift * 5), '#000000');
            ctx.restore();
        }

        // higher reads as nearer, since the plan view has nothing else to say it
        paintBall(ball, sx(ball.x, ball.y), sy(ball.x, ball.y),
            R * scale * Math.min(1.5, 1 + lift * 2.5));
    }

    /** One ball as a disc, wherever a view has worked out it belongs. */
    function paintBall(ball, px, py, r) {
        if (r < 0.4) return;
        var striped = ball.id > 8;

        disc(px, py, r, striped ? '#f6f4ef' : BallSkins.color(ball.id));
        if (striped) {
            // the band across the middle, clipped to the ball
            ctx.save();
            ctx.beginPath();
            ctx.arc(px, py, r, 0, Math.PI * 2);
            ctx.clip();
            ctx.fillStyle = BallSkins.color(ball.id);
            ctx.fillRect(px - r, py - r * 0.52, r * 2, r * 1.04);
            ctx.restore();
        }

        // the lamp hangs over the table, so the highlight sits up and left
        var shade = ctx.createRadialGradient(px - r * 0.35, py - r * 0.4, r * 0.1,
            px, py, r);
        shade.addColorStop(0, 'rgba(255,255,255,0.38)');
        shade.addColorStop(0.55, 'rgba(255,255,255,0.0)');
        shade.addColorStop(1, 'rgba(0,0,0,0.42)');
        ctx.fillStyle = shade;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();

        if (ball.id === 0) {
            disc(px + r * 0.3, py - r * 0.25, r * 0.16, '#c1262d');   // the measle dot
            return;
        }

        var spot = r * 0.52;
        if (spot < 3.5) return;                 // too small to read: leave it plain
        disc(px, py, spot, '#faf8f3');
        ctx.fillStyle = '#16181b';
        ctx.font = 'bold ' + Math.round(spot * 1.25) + 'px Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(ball.id), px, py + spot * 0.08);
    }

    /* -------------------------- cue and guides ------------------------ */

    function drawAim() {
        if (!aim) return;

        var ball = aim.ball;
        var ux = Math.cos(aim.angle), uy = Math.sin(aim.angle);
        var elev = aim.elevation || 0;

        var hit = world.firstContact(ball.x, ball.y, ux, uy, ball);
        var range = hit ? hit.distance : 3.2;
        var hx = ball.x + ux * range, hy = ball.y + uy * range;

        // start the guide clear of the ball so the disc stays readable
        var from = Math.min(R * 2.2, range * 0.5);
        line(ball.x + ux * from, ball.y + uy * from, hx, hy,
            '#ffffff', Math.max(1, scale * 0.0035), 0.85);

        if (elev > 0.17) {
            // raised enough to jump: the ball is going over whatever is in the
            // way, so the contact guides on the cloth would be telling stories
            hit = null;
        } else if (hit) {
            ctx.save();
            ctx.globalAlpha = 0.55;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = Math.max(1, R * 0.12 * scale);
            ctx.beginPath();
            ctx.arc(sx(hx, hy), sy(hx, hy), R * scale, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        if (hit && hit.type === 'ball') {
            // object ball leaves along the line of centres, cue ball at a right
            // angle to it - the two lines every player draws in their head
            var ox = hit.ball.x - hx, oy = hit.ball.y - hy;
            var ol = Math.sqrt(ox * ox + oy * oy) || 1;
            ox /= ol; oy /= ol;
            line(hit.ball.x, hit.ball.y, hit.ball.x + ox * 0.45, hit.ball.y + oy * 0.45,
                '#ffd35c', Math.max(1, scale * 0.003), 0.8);

            var cutX = -oy, cutY = ox;
            if (cutX * ux + cutY * uy < 0) { cutX = -cutX; cutY = -cutY; }
            line(hx, hy, hx + cutX * 0.28, hy + cutY * 0.28,
                '#7fd0ff', Math.max(1, scale * 0.003), 0.6);
        }

        drawCue(ball, ux, uy, elev);
    }

    function drawCue(ball, ux, uy, elev) {
        // Seen from above, raising the butt foreshortens the stick: at ninety
        // degrees it is end on and all that is left is the tip.
        var flat = Math.cos(elev);
        var back = R * 1.15 + aim.power * 0.22;
        var len = 1.35 * flat;

        var tipX = ball.x - ux * back, tipY = ball.y - uy * back;
        var buttX = tipX - ux * len, buttY = tipY - uy * len;

        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#c9a06a';
        ctx.lineWidth = Math.max(1.5, R * 0.55 * scale);
        ctx.beginPath();
        ctx.moveTo(sx(tipX, tipY), sy(tipX, tipY));
        ctx.lineTo(sx(buttX, buttY), sy(buttX, buttY));
        ctx.stroke();

        var ferrule = R * 0.5;
        ctx.strokeStyle = '#2a4a8c';
        ctx.lineWidth = Math.max(1.5, R * 0.42 * scale);
        ctx.beginPath();
        ctx.moveTo(sx(tipX, tipY), sy(tipX, tipY));
        ctx.lineTo(sx(tipX - ux * ferrule, tipY - uy * ferrule),
            sy(tipX - ux * ferrule, tipY - uy * ferrule));
        ctx.stroke();
        ctx.restore();

        if (elev > 0.05) drawElevation(tipX, tipY, ux, uy, elev);
        if (aim.side || aim.vert) drawTip(ball);
    }

    /**
     * How far the cue is raised, written beside the shaft. Seen from above a
     * raised cue only gets shorter, which is not much to go on, so the angle is
     * spelled out next to it.
     */
    function drawElevation(tipX, tipY, ux, uy, elev) {
        var ax = dx2(ux, uy), ay = dy2(ux, uy);
        var al = Math.sqrt(ax * ax + ay * ay) || 1;
        ax /= al; ay /= al;

        // a step back along the shaft, then out to the side of it
        var px = sx(tipX, tipY) - ax * R * 4.5 * scale - ay * R * 1.6 * scale;
        var py = sy(tipX, tipY) - ay * R * 4.5 * scale + ax * R * 1.6 * scale;

        ctx.save();
        ctx.font = 'bold ' + Math.max(11, Math.round(R * 0.85 * scale)) +
            'px Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';     // readable over the cloth
        ctx.strokeText(Math.round(elev * 180 / Math.PI) + '\u00b0', px, py);
        ctx.fillStyle = '#ffd35c';
        ctx.fillText(Math.round(elev * 180 / Math.PI) + '\u00b0', px, py);
        ctx.restore();
    }

    /** Where on the cue ball the tip is going to land. */
    function drawTip(ball) {
        var px = sx(ball.x, ball.y), py = sy(ball.x, ball.y);
        var r = R * scale;
        // side spin runs across the aim line, top and bottom along it
        var ax = dx2(Math.cos(aim.angle), Math.sin(aim.angle));
        var ay = dy2(Math.cos(aim.angle), Math.sin(aim.angle));
        var al = Math.sqrt(ax * ax + ay * ay) || 1;
        ax /= al; ay /= al;

        var ox = (-ay) * aim.side * r * 0.6 + ax * aim.vert * r * 0.6;
        var oy = (ax) * aim.side * r * 0.6 + ay * aim.vert * r * 0.6;
        disc(px + ox, py + oy, Math.max(2, r * 0.22), '#2a4a8c');
    }

    /** Where the cue ball would be put down, while it is in hand. */
    function drawInHand() {
        if (!hand) return;
        var px = sx(hand.x, hand.y), py = sy(hand.x, hand.y);
        var colour = hand.legal ? '#ffffff' : '#ff5a4a';

        ctx.save();
        ctx.globalAlpha = 0.4;
        disc(px, py, R * scale, colour);
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = colour;
        ctx.lineWidth = Math.max(1.5, R * 0.14 * scale);
        ctx.beginPath();
        ctx.arc(px, py, R * 1.45 * scale, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    /* ------------------------ the cue ball's eye ---------------------- */

    var FOV = 72 * Math.PI / 180;    // vertical, the same as the three.js camera
    var NEAR = R * 0.25;
    var RAIL_H = R * 1.35;           // cushion height above the cloth
    var ROOM = '#252b34';            // the backdrop, so there is a horizon
    var PITCH = 0.16;                // tipped down, so the cloth fills the frame

    // the camera, rebuilt every frame: origin, the three axes it looks along,
    // and how many pixels a unit at unit depth covers
    var eye = {x: 0, y: 0, h: R};
    var fwd = {x: 1, y: 0, h: 0}, rgt = {x: 0, y: -1, h: 0}, upv = {x: 0, y: 0, h: 1};
    var focal = 1, povMid = {x: 0, y: 0};

    function aimPov(cueBall, angle, rect) {
        var moving = cueBall && cueBall.speed() > 0.05;
        var ux = moving ? cueBall.vx : Math.cos(angle);
        var uy = moving ? cueBall.vy : Math.sin(angle);
        var len = Math.sqrt(ux * ux + uy * uy) || 1;
        ux /= len; uy /= len;

        // while the ball is in hand the view rides the marker instead: the ball
        // itself is off the table until it is put down
        eye.x = hand ? hand.x : cueBall.x;
        eye.y = hand ? hand.y : cueBall.y;
        eye.h = Math.max((hand ? R : cueBall.height) + R * 0.5, R * 1.2);

        var cp = Math.cos(PITCH), sp = Math.sin(PITCH);
        fwd.x = ux * cp; fwd.y = uy * cp; fwd.h = -sp;
        rgt.x = uy; rgt.y = -ux; rgt.h = 0;       // table +y is to the left
        upv.x = ux * sp; upv.y = uy * sp; upv.h = cp;

        focal = (rect.h / 2) / Math.tan(FOV / 2);
        povMid.x = rect.x + rect.w / 2;
        povMid.y = rect.y + rect.h / 2;
    }

    /** A point on the cloth, in the camera's own frame. */
    function toCam(x, y, h) {
        var vx = x - eye.x, vy = y - eye.y, vh = h - eye.h;
        return {
            x: vx * rgt.x + vy * rgt.y + vh * rgt.h,
            y: vx * upv.x + vy * upv.y + vh * upv.h,
            z: vx * fwd.x + vy * fwd.y + vh * fwd.h
        };
    }

    function project(c) {
        return {x: povMid.x + focal * c.x / c.z, y: povMid.y - focal * c.y / c.z};
    }

    /** Where two camera space points cross the near plane. */
    function atNear(p, q) {
        var t = (NEAR - p.z) / (q.z - p.z);
        return {x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: NEAR};
    }

    /**
     * Fill a polygon given as [x, y, height] table points. Anything behind the
     * camera is cut off first: projecting a point with a negative depth flips it
     * through the origin and turns the shape inside out.
     */
    function fillPoly3(pts, colour, alpha) {
        var cam = pts.map(function (p) { return toCam(p[0], p[1], p[2]); });
        var out = [];
        for (var i = 0; i < cam.length; i++) {
            var p = cam[i], q = cam[(i + 1) % cam.length];
            if (p.z > NEAR) out.push(p);
            if ((p.z > NEAR) !== (q.z > NEAR)) out.push(atNear(p, q));
        }
        if (out.length < 3) return;

        ctx.save();
        if (alpha !== undefined) ctx.globalAlpha = alpha;
        ctx.fillStyle = colour;
        ctx.beginPath();
        for (var j = 0; j < out.length; j++) {
            var s = project(out[j]);
            if (j) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    /** The same near clip along a line: `close` joins the last point to the first. */
    function stroke3(pts, colour, width, alpha, close) {
        var cam = pts.map(function (p) { return toCam(p[0], p[1], p[2]); });
        var out = [];
        var n = close ? cam.length : cam.length - 1;
        for (var i = 0; i < n; i++) {
            var p = cam[i], q = cam[(i + 1) % cam.length];
            if (p.z > NEAR) out.push(p);
            if ((p.z > NEAR) !== (q.z > NEAR)) out.push(atNear(p, q));
        }
        // the loop only ever pushes the start of each span, so an open line has
        // to be given its far end - without it a two point line drew nothing
        var end = cam[cam.length - 1];
        if (!close && end.z > NEAR) out.push(end);
        else if (close && out.length) out.push(out[0]);
        if (out.length < 2) return;

        ctx.save();
        ctx.globalAlpha = alpha === undefined ? 1 : alpha;
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (var j = 0; j < out.length; j++) {
            var s = project(out[j]);
            if (j) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y);
        }
        ctx.stroke();
        ctx.restore();
    }

    /** A circle lying flat on the cloth, as a ring of table points. */
    function ring(x, y, radius, height, steps) {
        var pts = [];
        for (var i = 0; i < steps; i++) {
            var t = i / steps * Math.PI * 2;
            pts.push([x + Math.cos(t) * radius, y + Math.sin(t) * radius, height]);
        }
        return pts;
    }

    /** The outward normal of a cushion segment, away from the playing surface. */
    function outward(seg) {
        var ang = Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1);
        var nx = Math.sin(ang), ny = -Math.cos(ang);
        if (nx * (W / 2 - (seg.x1 + seg.x2) / 2) +
            ny * (H / 2 - (seg.y1 + seg.y2) / 2) > 0) { nx = -nx; ny = -ny; }
        return {x: nx, y: ny};
    }

    function depthOf(x, y, h) {
        return toCam(x, y, h).z;
    }

    function drawPov(rect, cueBall, angle) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
        ctx.clip();

        ctx.fillStyle = ROOM;                    // the room, and with it a horizon
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

        if (!cueBall) { ctx.restore(); return; }
        aimPov(cueBall, angle, rect);

        var out = CUSHION_D + FRAME;
        fillPoly3([[-out, -out, 0], [W + out, -out, 0],
            [W + out, H + out, 0], [-out, H + out, 0]], WOOD);
        fillPoly3([[-CUSHION_D, -CUSHION_D, 0], [W + CUSHION_D, -CUSHION_D, 0],
            [W + CUSHION_D, H + CUSHION_D, 0], [-CUSHION_D, H + CUSHION_D, 0]], CLOTH);

        world.pockets.forEach(function (p) {
            fillPoly3(ring(p.x, p.y, p.radius * 1.05, 0.002, 20), '#07090b');
        });
        (world.pocketCuts || []).forEach(function (c) {
            fillPoly3([[c.x1, c.y1, 0.002], [c.x2, c.y1, 0.002],
                [c.x2, c.y2, 0.002], [c.x1, c.y2, 0.002]], '#07090b');
        });

        stroke3([[W * 0.25, 0, 0.003], [W * 0.25, H, 0.003]],
            '#bfd8c6', 1, 0.35);
        fillPoly3(ring(W * 0.75, H / 2, R * 0.22, 0.003, 14), '#cfe4d5', 0.5);

        drawPovAim();

        // the rails, furthest first: the near ones stand in front of them
        world.cushions.slice().sort(function (p, q) {
            return depthOf((q.x1 + q.x2) / 2, (q.y1 + q.y2) / 2, RAIL_H) -
                depthOf((p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2, RAIL_H);
        }).forEach(function (seg) {
            var n = outward(seg);
            var ox = n.x * CUSHION_D, oy = n.y * CUSHION_D;
            // the face a ball hits, then the top the frame sits behind
            fillPoly3([[seg.x1, seg.y1, 0], [seg.x2, seg.y2, 0],
                [seg.x2, seg.y2, RAIL_H], [seg.x1, seg.y1, RAIL_H]], RUBBER);
            fillPoly3([[seg.x1, seg.y1, RAIL_H], [seg.x2, seg.y2, RAIL_H],
                [seg.x2 + ox, seg.y2 + oy, RAIL_H], [seg.x1 + ox, seg.y1 + oy, RAIL_H]],
                '#0d5334');
            fillPoly3([[seg.x1 + ox, seg.y1 + oy, RAIL_H], [seg.x2 + ox, seg.y2 + oy, RAIL_H],
                [seg.x2 + ox * 3.1, seg.y2 + oy * 3.1, RAIL_H],
                [seg.x1 + ox * 3.1, seg.y1 + oy * 3.1, RAIL_H]], '#6b3d26');
        });

        // the balls, furthest first. The cue ball is skipped: the camera is
        // sitting inside it, so all it would draw is the inside of the shell.
        world.balls.filter(function (b) {
            return b.active && b.id !== 0 && b.height > -R;
        }).map(function (b) {
            return {ball: b, z: depthOf(b.x, b.y, b.height)};
        }).filter(function (d) {
            return d.z > NEAR;
        }).sort(function (p, q) {
            return q.z - p.z;
        }).forEach(function (d) {
            var s = project(toCam(d.ball.x, d.ball.y, d.ball.height));
            paintBall(d.ball, s.x, s.y, R * focal / d.z);
        });

        ctx.restore();
    }

    /** The same guides the table view draws, lying on the cloth. */
    function drawPovAim() {
        if (!aim) return;

        var ball = aim.ball;
        var ux = Math.cos(aim.angle), uy = Math.sin(aim.angle);
        var hit = world.firstContact(ball.x, ball.y, ux, uy, ball);
        var range = hit ? hit.distance : 3.2;
        var hx = ball.x + ux * range, hy = ball.y + uy * range;

        stroke3([[ball.x + ux * R * 2.2, ball.y + uy * R * 2.2, R * 0.5],
            [hx, hy, R * 0.5]], '#ffffff', 2, 0.85);

        if ((aim.elevation || 0) > 0.17 || !hit) return;   // a jump clears it all
        stroke3(ring(hx, hy, R, 0.004, 24), '#ffffff', 2, 0.5, true);
    }

    /* ----------------------------- the panes -------------------------- */

    var SPLIT_GAP = 8;

    /** Pixels along each edge that the page's own panels are sitting on. */
    this.setTableInsets = function () { /* the panes already dodge the bands */ };

    /** Bands along the top and bottom that the page's own panels are sitting on. */
    this.setPaneRegion = function (top, bottom) {
        region.top = top || 0;
        region.bottom = bottom || 0;
    };

    /** How much of the free space the upper pane gets, 0.2 to 0.8. */
    this.setSplit = function (ratio) {
        splitRatio = Math.max(0.2, Math.min(0.8, ratio));
        return splitRatio;
    };

    this.getSplit = function () { return splitRatio; };

    this.swapViews = function () {
        swapped = !swapped;
        return swapped;
    };

    this.isSwapped = function () { return swapped; };

    /** The balls are read straight out of the world at draw time. */
    this.syncBalls = function () { /* nothing to copy across */ };

    this.setAim = function (next) { aim = next || null; };
    this.setInHand = function (spot) { hand = spot || null; };

    /** Tells the page this is the flat renderer rather than the three.js one. */
    this.flat = true;

    this.render = function (cueBall, angle) {
        var w = canvas.clientWidth, h = canvas.clientHeight;
        var dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        ctx.fillStyle = BACK;
        ctx.fillRect(0, 0, w, h);

        // The panes tile whatever the panels have left, and divide it along its
        // longer side: a landscape window gives two panes side by side, a tall
        // one stacks them. Same layout as render.js, so the page's seam handle
        // and captions land in the same places either way.
        var top = Math.min(region.top, h * 0.45);
        var bottom = Math.min(region.bottom, h * 0.45);
        var freeH = Math.max(120, h - top - bottom);
        var sideBySide = w >= freeH;

        var half = SPLIT_GAP / 2, upper, lower;
        if (sideBySide) {
            var cutX = Math.round(w * splitRatio);
            upper = {x: 0, y: top, w: Math.max(40, cutX - half), h: freeH};
            lower = {x: cutX + half, y: top, w: Math.max(40, w - cutX - half), h: freeH};
        } else {
            var cutY = top + Math.round(freeH * splitRatio);
            upper = {x: 0, y: top, w: w, h: Math.max(40, cutY - half - top)};
            lower = {x: 0, y: cutY + half, w: w, h: Math.max(40, h - bottom - cutY - half)};
        }

        var plan = swapped ? lower : upper;
        drawTop(plan);
        drawPov(swapped ? upper : lower, cueBall, angle);

        return {
            table: plan,
            pov: swapped ? upper : lower,
            seam: sideBySide
                ? {x: upper.w, y: top, w: SPLIT_GAP, h: freeH, vertical: true}
                : {x: 0, y: top + upper.h, w: w, h: SPLIT_GAP, vertical: false},
            width: w, height: h
        };
    };

    /** The table from above, fitted to its own pane. */
    function drawTop(rect) {
        fit(rect);

        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
        ctx.clip();

        drawTable();
        drawAim();
        world.balls.forEach(drawBall);
        drawInHand();

        ctx.restore();
    }

    /**
     * Turn a pointer position into table coordinates, using the pane that is
     * currently showing the table from above.
     */
    this.screenToTable = function (clientX, clientY, rects) {
        var box = canvas.getBoundingClientRect();
        var px = clientX - box.left, py = clientY - box.top;

        var pane = rects.table;
        if (px < pane.x || px > pane.x + pane.w ||
            py < pane.y || py > pane.y + pane.h) return null;

        // invert sx/sy: the matrix only ever swaps and flips axes
        var det = a * d - b * c;
        if (!det) return null;
        var qx = px - e, qy = py - f;
        return {x: (d * qx - c * qy) / det, y: (a * qy - b * qx) / det};
    };
}
