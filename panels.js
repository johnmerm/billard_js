/**
 * panels.js - lets the heads up panels be dragged out of the way.
 *
 * The panels float over the cloth, and sooner or later one of them sits exactly
 * where the cue ball is. Each one can be picked up by its grip (or by any part
 * of it that is not a control) and dropped anywhere on screen; where they end up
 * is remembered between sessions, and a double tap on a grip puts one back.
 *
 * A panel is normally moved by writing left/top onto the element. The point of
 * view inset is not an element though - it is a viewport the renderer draws into
 * - so it registers an `onMove` and passes the position along itself.
 */
var Panels = (function () {
    'use strict';

    var STORE = 'billiards.panels';
    var placed = read();
    var registered = [];
    var front = 10;              // panels come forward as they are picked up

    function read() {
        try {
            return JSON.parse(window.localStorage.getItem(STORE)) || {};
        } catch (e) {
            return {};               // private browsing, or nothing saved yet
        }
    }

    function write() {
        try {
            window.localStorage.setItem(STORE, JSON.stringify(placed));
        } catch (e) { /* nothing worth failing over */ }
    }

    function clamp(v, lo, hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    /** Keep a panel on screen whatever size the window is. */
    function fit(el, x, y) {
        var r = el.getBoundingClientRect();
        return {
            x: clamp(x, 4, Math.max(4, window.innerWidth - r.width - 4)),
            y: clamp(y, 4, Math.max(4, window.innerHeight - r.height - 4))
        };
    }

    /**
     * @param {Element} el    the panel
     * @param {string} key    name to remember its position under
     * @param {Object} [opts] {onMove, onReset, onTap} - onMove takes over placing it
     */
    function register(el, key, opts) {
        if (!el) {
            // A panel the page does not have. This happens when a browser or a
            // cdn serves a fresh index.html alongside a stale script, or the
            // other way round; one missing panel should not take the game down
            // with it.
            if (window.console) window.console.warn('panels: no element for "' + key + '"');
            return null;
        }
        opts = opts || {};

        var grip = document.createElement('div');
        grip.className = 'grip';
        grip.title = 'Drag to move, double tap to put back';
        grip.innerHTML = '&#8942;&#8942;';
        el.appendChild(grip);

        var entry = {el: el, key: key, opts: opts};
        registered.push(entry);

        function apply(x, y) {
            var p = fit(el, x, y);
            if (opts.onMove) {
                opts.onMove(p.x, p.y);
            } else {
                el.style.left = p.x + 'px';
                el.style.top = p.y + 'px';
                el.style.right = 'auto';
                el.style.bottom = 'auto';
            }
            return p;
        }
        entry.apply = apply;

        function reset() {
            delete placed[key];
            write();
            el.style.left = el.style.top = el.style.right = el.style.bottom = '';
            if (opts.onReset) opts.onReset();
        }

        var drag = null;

        el.addEventListener('pointerdown', function (e) {
            if (e.button) return;                       // left button or a finger only
            if (!grip.contains(e.target) && e.target.closest &&
                e.target.closest('button, canvas, input, kbd')) {
                return;                                 // that is a control, not the panel
            }

            var r = el.getBoundingClientRect();
            drag = {
                dx: e.clientX - r.left, dy: e.clientY - r.top,
                x: e.clientX, y: e.clientY, moved: false,
                onGrip: grip.contains(e.target)
            };
            el.classList.add('dragging');
            el.style.zIndex = ++front;    // whatever you just grabbed sits on top
            try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
            e.preventDefault();
            e.stopPropagation();
        });

        el.addEventListener('pointermove', function (e) {
            if (!drag) return;
            if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
            if (drag.moved) apply(e.clientX - drag.dx, e.clientY - drag.dy);
            e.preventDefault();
        });

        var lastGripTap = 0;

        function release(e) {
            if (!drag) return;
            el.classList.remove('dragging');

            if (drag.moved) {
                var r = el.getBoundingClientRect();
                placed[key] = {x: r.left, y: r.top};
                write();
            } else if (drag.onGrip) {
                // Cancelling pointerdown costs us the browser's own dblclick, so
                // the double tap is counted here instead.
                var now = Date.now();
                if (now - lastGripTap < 400) {
                    reset();
                    lastGripTap = 0;
                } else {
                    lastGripTap = now;
                }
            } else if (opts.onTap) {
                opts.onTap(e);
            }
            drag = null;
        }
        el.addEventListener('pointerup', release);
        el.addEventListener('pointercancel', release);
        el.addEventListener('lostpointercapture', release);

        grip.addEventListener('dblclick', function (e) {
            reset();                 // if the browser does send one, honour it
            e.preventDefault();
            e.stopPropagation();
        });

        if (placed[key]) apply(placed[key].x, placed[key].y);
        return entry;
    }

    /** Put everything back where it started. */
    function resetAll() {
        registered.forEach(function (entry) {
            delete placed[entry.key];
            entry.el.style.left = entry.el.style.top = '';
            entry.el.style.right = entry.el.style.bottom = '';
            entry.el.style.zIndex = '';
            if (entry.opts.onReset) entry.opts.onReset();
        });
        write();
    }

    /** A smaller window can leave a panel off screen: pull them all back in. */
    function refit() {
        registered.forEach(function (entry) {
            var p = placed[entry.key];
            if (p) {
                var fitted = entry.apply(p.x, p.y);
                placed[entry.key] = fitted;
            }
        });
        write();
    }

    window.addEventListener('resize', refit);

    return {register: register, resetAll: resetAll, refit: refit};
})();
