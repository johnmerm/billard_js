var scale = 4;
var edge = 100;
var radius = 3;
var wall = 2;


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

var uds = [0,1,
            2,9,
           10,8,3,
          4,11,5,12,
         13,6,14,7,15];
function init() {


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

    bodyDef.type = b2Body.b2_dynamicBody;
//        fixDef = new b2FixtureDef;
//        fixDef.density = 1.0;
//        fixDef.friction = 0.7;
//        fixDef.restitution = 0.4;

    fixDef.shape = new b2CircleShape(radius);
    fixDef.userData = 0;

    bodyDef.position.Set(edge / 2, edge / 2);
    world.CreateBody(bodyDef).CreateFixture(fixDef);

    var ud = 1;
    for (var i = 0; i < 5; i++) {
        var x = edge + i * radius;
        var y = edge / 2 - i * radius;
        for (var j = 0; j <= i; j++) {
            fixDef.userData = uds[ud++];
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