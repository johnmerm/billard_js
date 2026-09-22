/**
 * render.js - draws a Phys world with three.js.
 *
 * Two cameras share one canvas: an orthographic one straight above the cloth
 * for the table view, and a perspective one that rides inside the cue ball for
 * the point of view shot. Either can be the big picture; the other becomes an
 * inset, so you can line a shot up from above and still watch it from the ball.
 *
 * Coordinates: cannon-es and three.js share a frame here - y up, origin in the
 * middle of the table - so ball bodies copy straight onto meshes. The game's
 * table coordinates (x along the length, y across the width, both from a
 * corner) are converted the same way phys.js does it: (x - W/2, h, -(y - H/2)).
 */
function Renderer(canvas, world) {
    'use strict';

    var self = this;
    var R = world.radius;
    var W = world.width, H = world.height;

    var RAIL_H = R * 1.35;       // cushion height above the cloth
    var CUSHION_D = R * 1.6;     // how deep the rubber sits
    var FRAME = R * 3.4;         // wooden surround, outside the cushions
    var CLOTH = 0x15754a;

    /* --------------------------- scene -------------------------------- */

    var renderer = new THREE.WebGLRenderer({canvas: canvas, antialias: true});
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setClearColor(0x0a0d10, 1);

    var scene = new THREE.Scene();

    scene.add(new THREE.AmbientLight(0x33383f, 2.2));

    var key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(0.4, 2.0, 0.8);
    scene.add(key);

    // Two lamps hung over the table, the way a real one is lit. Their strength
    // is in candela and falls off with the square of the distance, so the
    // numbers are much larger than they were under the old lighting model.
    [-W * 0.24, W * 0.24].forEach(function (lx) {
        var lamp = new THREE.PointLight(0xfff1dc, 2.6, 3.2);
        lamp.position.set(lx, 0.8, 0);
        scene.add(lamp);
    });

    /* --------------------------- table -------------------------------- */

    function box(w, h, d, color, x, y, z, shininess) {
        var mesh = new THREE.Mesh(
            new THREE.BoxGeometry(w, h, d),
            new THREE.MeshPhongMaterial({color: color, shininess: shininess || 6})
        );
        mesh.position.set(x, y, z);
        scene.add(mesh);
        return mesh;
    }

    // the room, so the point of view shot has somewhere to look
    // unlit on purpose: it is a backdrop, and a lit one this far from the
    // lamps just reads as black from the cue ball's eye line
    var room = new THREE.Mesh(
        new THREE.BoxGeometry(14, 5, 14),
        new THREE.MeshBasicMaterial({color: 0x252b34, side: THREE.BackSide})
    );
    room.position.y = 5 / 2 - 0.85;
    scene.add(room);

    // cloth bed, reaching back under the pocket mouths
    var bedOver = CUSHION_D + R * 1.2;
    box(W + 2 * bedOver, 0.03, H + 2 * bedOver, CLOTH, 0, -0.015, 0, 2);

    // wooden surround, sitting just outside the cushions so the rubber shows
    var WOOD = 0x5a3320, frameH = R * 2.8, frameY = RAIL_H - frameH / 2;
    var fx = W / 2 + CUSHION_D + FRAME / 2, fz = H / 2 + CUSHION_D + FRAME / 2;
    box(W + 2 * (CUSHION_D + FRAME), frameH, FRAME, WOOD, 0, frameY, -fz, 26);
    box(W + 2 * (CUSHION_D + FRAME), frameH, FRAME, WOOD, 0, frameY, fz, 26);
    box(FRAME, frameH, H + 2 * CUSHION_D, WOOD, -fx, frameY, 0, 26);
    box(FRAME, frameH, H + 2 * CUSHION_D, WOOD, fx, frameY, 0, 26);

    // legs, only ever seen from the cue ball's eye line
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(function (s) {
        box(FRAME * 1.2, 0.78, FRAME * 1.2, 0x3f2417,
            s[0] * (W / 2 - FRAME), -0.42, s[1] * (H / 2 - FRAME * 0.2), 10);
    });

    // cushions come straight from the physics segments, jaw cuts included
    var rubber = new THREE.MeshPhongMaterial({color: 0x0a4229, shininess: 18});
    world.cushions.forEach(function (c) {
        if (c.restitution !== undefined && c.restitution < 0.3) return; // dead outer wall
        var len = Math.sqrt((c.x2 - c.x1) * (c.x2 - c.x1) + (c.y2 - c.y1) * (c.y2 - c.y1));
        var depth = CUSHION_D;
        var mesh = new THREE.Mesh(new THREE.BoxGeometry(len, RAIL_H, depth), rubber);
        var mx = (c.x1 + c.x2) / 2, my = (c.y1 + c.y2) / 2;
        var ang = Math.atan2(c.y2 - c.y1, c.x2 - c.x1);

        // push the body of the cushion outward, away from the playing surface
        var nx = Math.sin(ang), ny = -Math.cos(ang);
        var toCentreX = W / 2 - mx, toCentreY = H / 2 - my;
        if (nx * toCentreX + ny * toCentreY > 0) { nx = -nx; ny = -ny; }

        mesh.position.set(mx + nx * depth / 2 - W / 2, RAIL_H / 2, -(my + ny * depth / 2 - H / 2));
        mesh.rotation.y = -ang;
        scene.add(mesh);
    });

    // pocket holes
    world.pockets.forEach(function (p) {
        var hole = new THREE.Mesh(
            new THREE.CircleGeometry(p.radius * 1.05, 28),
            new THREE.MeshBasicMaterial({color: 0x07090b})
        );
        hole.rotation.x = -Math.PI / 2;
        hole.position.set(p.x - W / 2, 0.004, -(p.y - H / 2));
        scene.add(hole);
    });

    // head string and foot spot, the markings you aim off
    var lineMat = new THREE.LineBasicMaterial({color: 0xbfd8c6, opacity: 0.35, transparent: true});
    var hs = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(W * 0.25 - W / 2, 0.005, -H / 2),
        new THREE.Vector3(W * 0.25 - W / 2, 0.005, H / 2)
    ]);
    scene.add(new THREE.Line(hs, lineMat));

    var spot = new THREE.Mesh(
        new THREE.CircleGeometry(R * 0.22, 16),
        new THREE.MeshBasicMaterial({color: 0xcfe4d5, opacity: 0.5, transparent: true})
    );
    spot.rotation.x = -Math.PI / 2;
    spot.position.set(W * 0.75 - W / 2, 0.005, 0);
    scene.add(spot);

    /* --------------------------- balls -------------------------------- */

    var ballGeom = new THREE.SphereGeometry(R, 32, 24);
    var shadowGeom = new THREE.CircleGeometry(R * 0.92, 20);
    var shadowMat = new THREE.MeshBasicMaterial({color: 0x000000, opacity: 0.32, transparent: true});

    var meshes = {}, shadows = {};
    world.balls.forEach(function (ball) {
        var texture = new THREE.CanvasTexture(BallSkins.canvas(ball.id));
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

        var mesh = new THREE.Mesh(ballGeom, new THREE.MeshPhongMaterial({
            map: texture, shininess: 80, specular: 0x555555
        }));
        scene.add(mesh);
        meshes[ball.id] = mesh;

        var shadow = new THREE.Mesh(shadowGeom, shadowMat.clone());
        shadow.rotation.x = -Math.PI / 2;
        scene.add(shadow);
        shadows[ball.id] = shadow;
    });

    /* ------------------------- cue and guides ------------------------- */

    // aim turns the yaw, elevation tips the pitch, power slides it back
    var cueYaw = new THREE.Object3D();
    var cuePitch = new THREE.Object3D();
    var cueSlide = new THREE.Object3D();
    cueYaw.add(cuePitch);
    cuePitch.add(cueSlide);

    var cue = cueSlide;
    var shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(R * 0.21, R * 0.38, 1.35, 16),
        new THREE.MeshPhongMaterial({color: 0xc9a06a, shininess: 45})
    );
    shaft.rotation.z = Math.PI / 2;           // lie the cylinder along +x
    shaft.position.x = -1.35 / 2;
    cue.add(shaft);

    var tip = new THREE.Mesh(
        new THREE.CylinderGeometry(R * 0.2, R * 0.21, R * 0.35, 12),
        new THREE.MeshPhongMaterial({color: 0x2a4a8c})
    );
    tip.rotation.z = Math.PI / 2;
    tip.position.x = -R * 0.18;
    cue.add(tip);
    scene.add(cueYaw);

    // aiming guide: cue ball path, ghost ball at contact, and the two lines the
    // balls take away from it
    function guideLine(color, opacity) {
        var g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
        var line = new THREE.Line(g, new THREE.LineBasicMaterial({
            color: color, transparent: true, opacity: opacity
        }));
        line.frustumCulled = false;      // the ends move every frame
        scene.add(line);
        return line;
    }

    var aimLine = guideLine(0xffffff, 0.85);
    var objectLine = guideLine(0xffd35c, 0.8);
    var cueLine = guideLine(0x7fd0ff, 0.6);

    var ghost = new THREE.Mesh(
        new THREE.TorusGeometry(R, R * 0.06, 6, 28),
        new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.55})
    );
    ghost.rotation.x = -Math.PI / 2;
    scene.add(ghost);

    // Where the cue ball would land while it is in hand. It is only ever a
    // marker: the ball itself stays off the table until it is put down, so
    // carrying it about cannot disturb the balls already on the cloth.
    var inHand = new THREE.Object3D();
    var inHandMat = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.4});
    var inHandBall = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 18), inHandMat);
    inHandBall.position.y = R;
    inHand.add(inHandBall);

    var inHandRingMat = new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.75});
    var inHandRing = new THREE.Mesh(new THREE.TorusGeometry(R * 1.45, R * 0.07, 6, 32), inHandRingMat);
    inHandRing.rotation.x = -Math.PI / 2;
    inHandRing.position.y = 0.006;
    inHand.add(inHandRing);

    inHand.visible = false;
    scene.add(inHand);

    /* --------------------------- cameras ------------------------------ */

    var margin = FRAME + R * 2;
    var tableInsets = {top: 0, bottom: 0, left: 0, right: 0};   // space the page needs
    var camCentre = {x: 0, z: 0};                               // where the top view looks
    var topCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 12);
    topCamera.position.set(0, 3, 0);
    topCamera.up.set(0, 0, -1);               // table +y points up the screen
    topCamera.lookAt(new THREE.Vector3(0, 0, 0));

    var povCamera = new THREE.PerspectiveCamera(72, 1.6, 0.004, 24);

    var swapped = false;     // false: table on top, cue ball view below
    var portrait = false;    // tall viewport: stand the table on end
    var splitRatio = 0.62;   // how much of the free area the upper pane gets
    var SPLIT_GAP = 8;       // the seam between the two panes
    var region = {top: 0, bottom: 0};   // bands the page's panels have taken

    /**
     * Fit the table into the part of the view the page has left free, then open
     * the camera back out to the whole canvas. The cloth still runs edge to
     * edge, but the table itself sits clear of the panels on top of it.
     */
    function fitTopCamera(w, h) {
        portrait = h > w;

        var t = tableInsets.top, b = tableInsets.bottom;
        var l = tableInsets.left, rt = tableInsets.right;
        var freeW = Math.max(60, w - l - rt), freeH = Math.max(60, h - t - b);

        // extents across and up the free area, in metres of table
        var across = ((portrait ? H : W) + 2 * margin) / 2;
        var up = ((portrait ? W : H) + 2 * margin) / 2;

        var viewAspect = freeW / freeH;
        if (viewAspect > across / up) across = up * viewAspect;
        else up = across / viewAspect;

        across *= w / freeW;
        up *= h / freeH;

        // shift the camera so the middle of the free area holds the middle of
        // the table: screen right and screen up land on different world axes
        // depending on which way round the table is
        var shiftRight = ((l - rt) / 2) * (2 * across / w);
        var shiftUp = ((b - t) / 2) * (2 * up / h);

        camCentre.x = portrait ? -shiftUp : -shiftRight;
        camCentre.z = portrait ? -shiftRight : shiftUp;

        topCamera.left = -across;
        topCamera.right = across;
        topCamera.top = up;
        topCamera.bottom = -up;
        topCamera.position.set(camCentre.x, 3, camCentre.z);
        // portrait puts table +x up the screen, landscape puts table +y up
        topCamera.up.set(portrait ? 1 : 0, 0, portrait ? 0 : -1);
        topCamera.lookAt(new THREE.Vector3(camCentre.x, 0, camCentre.z));
        topCamera.updateProjectionMatrix();
    }

    /** Pixels along each edge that the page's own panels are sitting on. */
    this.setTableInsets = function (insets) {
        tableInsets.top = (insets && insets.top) || 0;
        tableInsets.bottom = (insets && insets.bottom) || 0;
        tableInsets.left = (insets && insets.left) || 0;
        tableInsets.right = (insets && insets.right) || 0;
    };

    /* --------------------------- updates ------------------------------ */

    /** Copy every ball's position and orientation out of the physics world. */
    this.syncBalls = function () {
        world.balls.forEach(function (ball) {
            var mesh = meshes[ball.id], shadow = shadows[ball.id];
            mesh.visible = shadow.visible = ball.active;
            if (!ball.active) return;

            // the rigid body already lives in this scene's coordinates, so its
            // position and orientation copy straight across
            mesh.position.copy(ball.body.position);
            mesh.quaternion.copy(ball.body.quaternion);

            // The table view looks straight down, where height does not show at
            // all, so a jumping ball would slide over another one and look like
            // a bug. Its shadow is what gives it away: it slides out from under
            // the ball, spreads and fades as the ball climbs.
            var lift = Math.max(0, ball.body.position.y - R);
            shadow.position.set(
                ball.body.position.x + R * 0.12 + lift * 0.45,
                0.006,
                ball.body.position.z + R * 0.1 + lift * 0.35
            );
            shadow.scale.setScalar(1 + lift * 5);
            shadow.material.opacity = 0.32 / (1 + lift * 14);
            shadow.visible = ball.body.position.y > -R;   // gone once it drops in
        });
    };

    function setLine(line, x1, y1, x2, y2, height) {
        var p = line.geometry.attributes.position;
        p.setXYZ(0, x1 - W / 2, height, -(y1 - H / 2));
        p.setXYZ(1, x2 - W / 2, height, -(y2 - H / 2));
        p.needsUpdate = true;
    }

    /**
     * Show the cue and the aiming guide.
     *
     * @param {?Object} aim {ball, angle, power, side, vert} or null to hide it
     */
    this.setAim = function (aim) {
        var visible = !!aim;
        self._cueVisible = visible;   // the pov pass hides the cue, then restores it
        cueYaw.visible = visible;
        aimLine.visible = visible;
        objectLine.visible = visible;
        cueLine.visible = visible;
        ghost.visible = visible;
        if (!visible) return;

        var ball = aim.ball;
        var dx = Math.cos(aim.angle), dy = Math.sin(aim.angle);

        // sit the cue on the ball, point it, raise it, then pull it back with
        // the power - the butt lifts and the tip stays where it strikes
        cueYaw.position.set(ball.x - W / 2, R + aim.vert * R * 0.8, -(ball.y - H / 2));
        cueYaw.rotation.y = Math.atan2(dy, dx);
        cuePitch.rotation.z = -(aim.elevation || 0);
        cueSlide.position.x = -(R * 1.15 + aim.power * 0.22);

        var hit = world.firstContact(ball.x, ball.y, dx, dy, ball);
        var range = hit ? hit.distance : 3.2;
        var hx = ball.x + dx * range, hy = ball.y + dy * range;

        // start the guide clear of the ball: the pov camera is inside it
        var from = Math.min(R * 2.2, range * 0.5);
        setLine(aimLine, ball.x + dx * from, ball.y + dy * from, hx, hy, R * 0.5);
        ghost.position.set(hx - W / 2, R, -(hy - H / 2));
        ghost.visible = !!hit;

        if ((aim.elevation || 0) > 0.17) {
            // raised enough to jump: the ball is going over whatever is in the
            // way, so the contact guides on the cloth would be telling stories
            ghost.visible = objectLine.visible = cueLine.visible = false;
        } else if (hit && hit.type === 'ball') {
            // object ball leaves along the line of centres, cue ball at a right
            // angle to it - the two lines every player draws in their head
            var ox = hit.ball.x - hx, oy = hit.ball.y - hy;
            var ol = Math.sqrt(ox * ox + oy * oy) || 1;
            ox /= ol; oy /= ol;
            setLine(objectLine, hit.ball.x, hit.ball.y, hit.ball.x + ox * 0.45, hit.ball.y + oy * 0.45, R);

            var cutX = -oy, cutY = ox;
            if (cutX * dx + cutY * dy < 0) { cutX = -cutX; cutY = -cutY; }
            setLine(cueLine, hx, hy, hx + cutX * 0.28, hy + cutY * 0.28, R);
            objectLine.visible = cueLine.visible = true;
        } else {
            objectLine.visible = cueLine.visible = false;
        }
    };

    /**
     * Show where the cue ball would be put down.
     *
     * @param {?Object} spot {x, y, legal} in table coordinates, or null to hide it
     */
    this.setInHand = function (spot) {
        inHand.visible = !!spot;
        if (!spot) return;

        inHand.position.set(spot.x - W / 2, 0, -(spot.y - H / 2));
        var colour = spot.legal ? 0xffffff : 0xff5a4a;
        inHandMat.color.setHex(colour);
        inHandRingMat.color.setHex(colour);
    };

    /** Where the point of view camera sits and looks. */
    function aimPov(cueBall, angle) {
        if (!cueBall) return;
        var moving = cueBall.speed() > 0.05;
        var dx = moving ? cueBall.vx : Math.cos(angle);
        var dy = moving ? cueBall.vy : Math.sin(angle);
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= len; dy /= len;

        // while the ball is in hand the view rides the marker instead
        var from = inHand.visible
            ? {x: inHand.position.x, y: R, z: inHand.position.z}
            : {x: cueBall.x - W / 2, y: cueBall.height, z: -(cueBall.y - H / 2)};
        var x = from.x, z = from.z;

        // Just above the centre of the ball, tipped down a touch so the cloth
        // and the object balls fill the frame rather than the room. It rides
        // the ball's real height, so a jump shot takes the view up with it.
        var eye = Math.max(from.y + R * 0.5, R * 1.2);
        povCamera.position.set(x, eye, z);
        povCamera.up.set(0, 1, 0);
        povCamera.lookAt(new THREE.Vector3(x + dx, eye - R * 0.4, z - dy));
    }

    /**
     * Hang the inset from the top or the bottom of the canvas, `offset` pixels
     * in, so the page can keep it clear of its own panels.
     */
    this.swapViews = function () {
        swapped = !swapped;
        return swapped;
    };

    this.isSwapped = function () {
        return swapped;
    };

    /**
     * Draw both views. The cue ball and the cue itself are hidden while the
     * point of view camera renders, since the camera lives inside the ball.
     *
     * @return {Object} pixel rectangles of the two views, for the HUD and picking
     */
    /**
     * Draw both views, one above the other. They are panes rather than a
     * picture in a picture: neither covers any part of the other, and the seam
     * between them can be dragged to give one more room than the other.
     *
     * @return {Object} the two pane rectangles and the seam, in css pixels
     */
    this.render = function (cueBall, angle) {
        var w = canvas.clientWidth, h = canvas.clientHeight;
        if (self._w !== w || self._h !== h) {
            renderer.setSize(w, h, false);
            self._w = w; self._h = h;
        }

        aimPov(cueBall, angle);

        // The panes tile whatever the panels have left, so neither view ends up
        // underneath the controls, and they divide it along its longer side: a
        // landscape window gives two panes side by side, a tall one stacks them.
        // A table is half as tall as it is wide, and squeezing it into a wide,
        // short strip wastes most of the room.
        var top = Math.min(region.top, h * 0.4);
        var bottom = Math.min(region.bottom, h * 0.4);
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

        var upperCam = swapped ? povCamera : topCamera;
        var lowerCam = swapped ? topCamera : povCamera;

        // clear the whole canvas first: the seam is never drawn into, and
        // scissored passes would leave last frame's pixels lying in it
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, w, h);
        renderer.clear();

        renderer.setScissorTest(true);
        drawPane(upperCam, upper, h);
        drawPane(lowerCam, lower, h);
        renderer.setScissorTest(false);

        return {
            table: swapped ? lower : upper,
            pov: swapped ? upper : lower,
            seam: sideBySide
                ? {x: upper.w, y: top, w: SPLIT_GAP, h: freeH, vertical: true}
                : {x: 0, y: top + upper.h, w: w, h: SPLIT_GAP, vertical: false},
            width: w, height: h
        };
    };

    function drawPane(camera, rect, canvasHeight) {
        if (camera === topCamera) {
            fitTopCamera(rect.w, rect.h);
        } else {
            povCamera.aspect = rect.w / rect.h;
            povCamera.updateProjectionMatrix();
        }
        drawView(camera, rect, canvasHeight);
    }

    /** Bands along the top and bottom that the page's own panels are sitting on. */
    this.setPaneRegion = function (top, bottom) {
        region.top = top || 0;
        region.bottom = bottom || 0;
    };

    /** How much of the free height the upper pane gets, 0.2 to 0.8. */
    this.setSplit = function (ratio) {
        splitRatio = Math.max(0.2, Math.min(0.8, ratio));
        return splitRatio;
    };

    this.getSplit = function () {
        return splitRatio;
    };

    function drawView(camera, rect, canvasHeight) {
        var cueMesh = meshes[0];
        // the point of view camera sits inside the cue ball, so the ball itself
        // and the stick behind it have to come out of the way
        var hideCue = (camera === povCamera);
        var markerWas = inHand.visible;
        if (hideCue) {
            cueMesh.visible = false;
            cueYaw.visible = false;
            inHand.visible = false;      // the camera is sitting inside it
        }

        // three.js counts viewport y from the bottom of the canvas
        var y = canvasHeight - rect.y - rect.h;
        renderer.setViewport(rect.x, y, rect.w, rect.h);
        renderer.setScissor(rect.x, y, rect.w, rect.h);
        renderer.render(scene, camera);

        if (hideCue) {
            cueMesh.visible = world.ball(0).active;
            cueYaw.visible = self._cueVisible;
            inHand.visible = markerWas;
        }
    }

    /**
     * Turn a pointer position into table coordinates, using whichever view is
     * currently showing the table from above.
     */
    this.screenToTable = function (clientX, clientY, rects) {
        var box = canvas.getBoundingClientRect();
        var px = clientX - box.left, py = clientY - box.top;
        var rect = rects.table;

        var u = (px - rect.x) / rect.w, v = (py - rect.y) / rect.h;
        if (u < 0 || u > 1 || v < 0 || v > 1) return null;

        var across = topCamera.right, up = topCamera.top;
        if (portrait) {
            return {
                x: (1 - v * 2) * up + W / 2 + camCentre.x,
                y: H / 2 - camCentre.z - (u * 2 - 1) * across
            };
        }
        return {
            x: (u * 2 - 1) * across + W / 2 + camCentre.x,
            y: (1 - v * 2) * up + H / 2 - camCentre.z
        };
    };

    this.scene = scene;
    this.three = renderer;
}
