/**
 * ball_skins.js - paints the sixteen pool balls onto canvases.
 *
 * Each skin is an equirectangular map for a sphere: u wraps around the ball and
 * v runs pole to pole, so a stripe is simply a band across the middle and the
 * numbers sit on the equator at opposite sides.
 */
var BallSkins = (function () {
    'use strict';

    var COLORS = [
        '#f6f4ef', // 0 cue
        '#f2c500', // 1 yellow
        '#1663b5', // 2 blue
        '#cf2018', // 3 red
        '#5b2a83', // 4 purple
        '#e2711d', // 5 orange
        '#1d7a3c', // 6 green
        '#7b2020', // 7 maroon
        '#17181c'  // 8 black
    ];

    var W = 512, H = 256;

    function makeCanvas() {
        var cv = document.createElement('canvas');
        cv.width = W;
        cv.height = H;
        return cv;
    }

    /** Number in a white circle, drawn at both equator "poles" of the map. */
    function numberSpot(ctx, x, number, radius) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, H / 2, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#faf8f3';
        ctx.fill();

        ctx.fillStyle = '#16181b';
        ctx.font = 'bold ' + Math.round(radius * 1.25) + 'px Helvetica, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(number), x, H / 2 + radius * 0.06);
        ctx.restore();
    }

    /** Soft shading so the ball does not read as a flat decal. */
    function polarShade(ctx) {
        var g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, 'rgba(0,0,0,0.35)');
        g.addColorStop(0.25, 'rgba(0,0,0,0.0)');
        g.addColorStop(0.75, 'rgba(0,0,0,0.0)');
        g.addColorStop(1, 'rgba(0,0,0,0.35)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
    }

    function cueBall() {
        var cv = makeCanvas(), ctx = cv.getContext('2d');
        ctx.fillStyle = COLORS[0];
        ctx.fillRect(0, 0, W, H);

        // measle-style dots: without them a spinning white ball looks static
        ctx.fillStyle = '#c1262d';
        var dots = [[100, 70], [250, 150], [400, 90], [180, 200], [330, 40], [60, 180]];
        for (var i = 0; i < dots.length; i++) {
            ctx.beginPath();
            ctx.arc(dots[i][0], dots[i][1], 11, 0, Math.PI * 2);
            ctx.fill();
        }
        polarShade(ctx);
        return cv;
    }

    function solidBall(n) {
        var cv = makeCanvas(), ctx = cv.getContext('2d');
        ctx.fillStyle = COLORS[n];
        ctx.fillRect(0, 0, W, H);
        numberSpot(ctx, W * 0.25, n, 52);
        numberSpot(ctx, W * 0.75, n, 52);
        polarShade(ctx);
        return cv;
    }

    function stripedBall(n) {
        var cv = makeCanvas(), ctx = cv.getContext('2d');
        ctx.fillStyle = '#f6f4ef';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = COLORS[n - 8];
        ctx.fillRect(0, H * 0.24, W, H * 0.52);
        numberSpot(ctx, W * 0.25, n, 46);
        numberSpot(ctx, W * 0.75, n, 46);
        polarShade(ctx);
        return cv;
    }

    var cache = {};

    return {
        colors: COLORS,

        /** Canvas skin for ball `n`, 0..15. */
        canvas: function (n) {
            if (cache[n]) return cache[n];
            var cv = n === 0 ? cueBall() : (n <= 8 ? solidBall(n) : stripedBall(n));
            cache[n] = cv;
            return cv;
        },

        /** Flat colour of a ball, handy for HUD chips. */
        color: function (n) {
            return n === 0 ? COLORS[0] : COLORS[n <= 8 ? n : n - 8];
        }
    };
})();
