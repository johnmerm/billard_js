var scale = 4;
var edge = 100;
var radius = 3;
var wall = 1;
var colors = ['azure', 'Yellow', 'Blue', 'Red', 'Purple', 'Orange', 'Lime', 'SaddleBrown', 'Black']
function init() {
    var b2Vec2 = Box2D.Common.Math.b2Vec2
        , b2AABB = Box2D.Collision.b2AABB
        , b2BodyDef = Box2D.Dynamics.b2BodyDef
        , b2Body = Box2D.Dynamics.b2Body
        , b2FixtureDef = Box2D.Dynamics.b2FixtureDef
        , b2Fixture = Box2D.Dynamics.b2Fixture
        , b2World = Box2D.Dynamics.b2World
        , b2MassData = Box2D.Collision.Shapes.b2MassData
        , b2PolygonShape = Box2D.Collision.Shapes.b2PolygonShape
        , b2CircleShape = Box2D.Collision.Shapes.b2CircleShape
        , b2DebugDraw = Box2D.Dynamics.b2DebugDraw
        , b2MouseJointDef = Box2D.Dynamics.Joints.b2MouseJointDef
        ;

    var world = new b2World(
        new b2Vec2(0, 0)    //gravity
        , true                 //allow sleep
    );

    var fixDef = new b2FixtureDef;
    fixDef.density = 1.0;
    fixDef.friction = 0.7;
    fixDef.restitution = 0.4;

    var bodyDef = new b2BodyDef;

    //create table
    bodyDef.type = b2Body.b2_staticBody;
    fixDef.shape = new b2PolygonShape;

    //horizontal edges
    fixDef.shape.SetAsBox((edge - 4 * radius) / 2, wall / 2);
    bodyDef.position.Set(edge / 2 + radius / 2, wall / 2);
    world.CreateBody(bodyDef).CreateFixture(fixDef);

    bodyDef.position.Set(3 * edge / 2 - radius / 2, wall / 2);
    world.CreateBody(bodyDef).CreateFixture(fixDef);

    bodyDef.position.Set(edge / 2 + radius / 2, edge - wall / 2);
    world.CreateBody(bodyDef).CreateFixture(fixDef);

    bodyDef.position.Set(3 * edge / 2 - radius / 2, edge - wall / 2);
    world.CreateBody(bodyDef).CreateFixture(fixDef);

    //vertical edges
    fixDef.shape.SetAsBox(wall / 2, edge / 2 - 3 * radius);
    bodyDef.position.Set(wall / 2, edge / 2);
    world.CreateBody(bodyDef).CreateFixture(fixDef);
    bodyDef.position.Set(2 * edge - wall / 2, edge / 2);
    world.CreateBody(bodyDef).CreateFixture(fixDef);

    //create balls
    var ud = 0;
    bodyDef.type = b2Body.b2_dynamicBody;
//        fixDef = new b2FixtureDef;
//        fixDef.density = 1.0;
//        fixDef.friction = 0.7;
//        fixDef.restitution = 0.4;

    fixDef.shape = new b2CircleShape(radius);
    fixDef.userData = ud;

    bodyDef.position.Set(edge / 2, edge / 2);
    world.CreateBody(bodyDef).CreateFixture(fixDef);

    for (var i = 0; i < 5; i++) {
        var x = edge + i * radius;
        var y = edge / 2 - i * radius;
        for (var j = 0; j <= i; j++) {
            fixDef.userData = ++ud;
            bodyDef.position.Set(x + i * radius, y + j * (2 * radius));

            world.CreateBody(bodyDef).CreateFixture(fixDef);
        }
    }



    window.requestAnimationFrame(update);

    //mouse

    var mouseX, mouseY, mousePVec, isMouseDown, selectedBody, mouseJoint;
    var canvasPosition = getElementPosition(document.getElementById("canvas"));

    document.addEventListener("mousedown", function (e) {
        isMouseDown = true;
        handleMouseMove(e);
        document.addEventListener("mousemove", handleMouseMove, true);
    }, true);

    document.addEventListener("mouseup", function () {
        document.removeEventListener("mousemove", handleMouseMove, true);
        isMouseDown = false;
        mouseX = undefined;
        mouseY = undefined;
    }, true);

    function handleMouseMove(e) {
        mouseX = (e.clientX - canvasPosition.x) / scale;
        mouseY = (e.clientY - canvasPosition.y) / scale;
    };

    function getBodyAtMouse() {
        mousePVec = new b2Vec2(mouseX, mouseY);
        var aabb = new b2AABB();
        aabb.lowerBound.Set(mouseX - 0.001, mouseY - 0.001);
        aabb.upperBound.Set(mouseX + 0.001, mouseY + 0.001);

        // Query the world for overlapping shapes.

        selectedBody = null;
        world.QueryAABB(getBodyCB, aabb);
        return selectedBody;
    }

    function getBodyCB(fixture) {
        if (fixture.GetBody().GetType() != b2Body.b2_staticBody) {
            if (fixture.GetShape().TestPoint(fixture.GetBody().GetTransform(), mousePVec)) {
                selectedBody = fixture.GetBody();
                return false;
            }
        }
        return true;
    }


    function draw() {

        var canvas = document.getElementById('canvas');
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        var body = world.GetBodyList();
        while (body) {
            var position = body.GetPosition();
            var fixture = body.GetFixtureList();
            if (fixture) {
                var shape = fixture.GetShape();
                var type = shape.GetType();
                //type:0 circle
                if (type === 0) {
                    var rad = shape.GetRadius();
                    ctx.beginPath();
                    ctx.arc(scale * position.x, scale * position.y, scale * rad, 0, 2 * Math.PI);
                    var ud = fixture.GetUserData();

                    if (ud) {

                        ctx.fillStyle = colors[ud > 8 ? ud - 8 : ud];
                        ctx.fill();
                    }
                    ctx.strokeStyle = ud > 8 ? 'White' : 'Black';
                    ctx.stroke();
                    ctx.fillStyle = 'Black';
                    ctx.fillText('' + ud, scale * position.x, scale * position.y);

                } else if (type === 1) {
                    //type:1 polygon
                }

                //console.log('('+position.x+','+position.y+')'+shape.GetType() + ' ' + fixture.GetUserData());
            } else {
                //console.log('body without fixture')
            }
            body = body.GetNext();
        }


    }


    //update
    function update(step) {

        if (window.lastStep) {
            var delta = step - window.lastStep;

            if (isMouseDown && (!mouseJoint)) {
                var body = getBodyAtMouse();
                if (body) {
                    var md = new b2MouseJointDef();
                    md.bodyA = world.GetGroundBody();
                    md.bodyB = body;
                    md.target.Set(mouseX, mouseY);
                    md.collideConnected = true;
                    md.maxForce = 300.0 * body.GetMass();
                    mouseJoint = world.CreateJoint(md);
                    body.SetAwake(true);
                }
            }

            if (mouseJoint) {
                if (isMouseDown) {
                    mouseJoint.SetTarget(new b2Vec2(mouseX, mouseY));
                } else {
                    world.DestroyJoint(mouseJoint);
                    mouseJoint = null;
                }
            }
            var elapsed_secs = delta;
            var timeStep = 1 / elapsed_secs;
            world.Step(timeStep, 10, 10);
            world.ClearForces();
            draw();
        }
        window.lastStep = step;
        window.requestAnimationFrame(update);
    };

    //helpers

    //http://js-tut.aardon.de/js-tut/tutorial/position.html
    function getElementPosition(element) {
        var elem = element, tagname = "", x = 0, y = 0;

        while ((typeof(elem) == "object") && (typeof(elem.tagName) != "undefined")) {
            y += elem.offsetTop;
            x += elem.offsetLeft;
            tagname = elem.tagName.toUpperCase();

            if (tagname == "BODY")
                elem = 0;

            if (typeof(elem) == "object") {
                if (typeof(elem.offsetParent) == "object")
                    elem = elem.offsetParent;
            }
        }

        return {x: x, y: y};
    }


};