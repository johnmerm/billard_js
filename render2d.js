/**
 * render2d.js - draws a Phys world with a plain 2d canvas.
 *
 * A stand-in for render.js on machines where WebGL will not start: the browser
 * has hardware acceleration switched off, the driver is blocklisted, or Chrome
 * has stopped falling back to software WebGL on its own. The physics, the rules
 * and every control are the same; only the picture is simpler.
 *
 * It draws the table from above and nothing else. The cue ball's point of view
 * needs a perspective camera and a room to look at, neither of which is worth
 * hand rolling here, so the page drops to a single pane and says so.
 *
 * Coordinates: everything is worked out in the game's table coordinates (x
 * along the length, y across the width, both from a corner) and mapped to css
 * pixels by `sx`/`sy`. The mapping only ever swaps and flips axes, so a table
 * rectangle stays an axis aligned rectangle on screen whichever way round the
 * table is standing.
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
    var splitRatio = 0.62;       // kept so the page's saved value survives
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

        world.pockets.forEach(function (p) {
            disc(sx(p.x, p.y), sy(p.x, p.y), p.radius * 1.05 * scale, '#07090b');
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
        var px = sx(ball.x, ball.y), py = sy(ball.x, ball.y);

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

        var r = R * scale * Math.min(1.5, 1 + lift * 2.5);   // higher reads as nearer
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

    /* ----------------------------- the page --------------------------- */

    /** Pixels along each edge that the page's own panels are sitting on. */
    this.setTableInsets = function () { /* the single pane already dodges them */ };

    /** Bands along the top and bottom that the page's own panels are sitting on. */
    this.setPaneRegion = function (top, bottom) {
        region.top = top || 0;
        region.bottom = bottom || 0;
    };

    this.setSplit = function (ratio) {
        splitRatio = Math.max(0.2, Math.min(0.8, ratio));
        return splitRatio;      // there is only one pane, but the page saves it
    };

    this.getSplit = function () { return splitRatio; };

    // there is no second view to swap with
    this.swapViews = function () { return false; };
    this.isSwapped = function () { return false; };

    /** The balls are read straight out of the world at draw time. */
    this.syncBalls = function () { /* nothing to copy across */ };

    this.setAim = function (next) { aim = next || null; };
    this.setInHand = function (spot) { hand = spot || null; };

    /** Tells the page this is the flat renderer, so it can drop the pov pane. */
    this.flat = true;

    this.render = function () {
        var w = canvas.clientWidth, h = canvas.clientHeight;
        var dpr = window.devicePixelRatio || 1;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        var top = Math.min(region.top, h * 0.45);
        var bottom = Math.min(region.bottom, h * 0.45);
        var pane = {x: 0, y: top, w: w, h: Math.max(120, h - top - bottom)};
        fit(pane);

        ctx.fillStyle = BACK;
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.beginPath();
        ctx.rect(pane.x, pane.y, pane.w, pane.h);
        ctx.clip();

        drawTable();
        drawAim();
        world.balls.forEach(drawBall);
        drawInHand();

        ctx.restore();

        return {
            table: pane,
            pov: {x: 0, y: 0, w: 0, h: 0},        // no second view to tap
            seam: {x: 0, y: 0, w: 0, h: 0, vertical: false},
            width: w, height: h
        };
    };

    /** Turn a pointer position into table coordinates. */
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
