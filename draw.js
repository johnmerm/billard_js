function draw() {
    var balls = {};
    var canvas = document.getElementById('canvas');
    var ctx = canvas.getContext('2d');
    ctx.strokeStyle = "black";
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

                var ud = fixture.GetUserData();
                balls[ud] = {x:position.x,y:position.y,angle:body.GetAngle(),v:body.GetLinearVelocity()};
                var pat = ctx.createPattern(pats[ud],'no-repeat');
                ctx.fillStyle = pat;



                ctx.translate(scale * (position.x), scale * (position.y));
                ctx.rotate(body.GetAngle());
                ctx.beginPath();
                ctx.moveTo(-10,0);
                ctx.lineTo(10,0);
                ctx.stroke();

                ctx.moveTo(0,-10);
                ctx.lineTo(0,10);
                ctx.stroke();

                //ctx.setTransform(1, 0, 0, 1, 0, 0);

                ctx.beginPath();
                ctx.arc(0,0, scale * rad, 0, 7);
                //this is required so that the texture will fill the rectangle
                // around the circle (-rad,0rad,rad,rad) instead of (0,0,2*rad,2*rad)
                ctx.translate(-scale * rad,-scale * rad);
                ctx.fill();
                ctx.stroke();



                ctx.setTransform(1, 0, 0, 1, 0, 0);
            } else if (type === 1) {
                //type:1 polygon
                var verts = shape.GetVertices();
                ctx.fillStyle='Chocolate';
                ctx.fillRect(scale * (position.x + verts[0].x),
                        scale * (position.y + verts[0].y),
                        scale * (verts[2].x - verts[0].x),
                        scale * (verts[2].y - verts[0].y));
            }

            //console.log('('+position.x+','+position.y+')'+shape.GetType() + ' ' + fixture.GetUserData());
        } else {
            //console.log('body without fixture')
        }
        body = body.GetNext();
    }
    return balls;


}