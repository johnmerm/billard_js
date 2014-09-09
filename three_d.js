

function init3d() {

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(90, 2, 1, 100);
    try {
        var renderer = new THREE.WebGLRenderer();
        if (renderer) {
            renderer.setSize(800, 400);
            document.getElementById('container3d').appendChild(renderer.domElement);


            camera.position.set(0,0,100);
            console.log(camera.lookAt);


        }
    }catch (e){
        console.log("WebGL cannot be init",e);
    }

    var plane = new THREE.Mesh(new THREE.PlaneGeometry(200,100),new THREE.MeshBasicMaterial({ color: 0x006400 }));
    scene.add(plane);
    var spheres = {};
    for (var i=0;i<16;i++) {
        var geometry = new THREE.SphereGeometry(3, 100, 100, 0, 7, 0, 7);
        var img_src = pats[i].src;
        var texture = THREE.ImageUtils.loadTexture(img_src);
        texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = false;

        var material = new THREE.MeshBasicMaterial({ map: texture });
        spheres[i]=new THREE.Mesh(geometry, material);

        scene.add(spheres[i]);
    }

    return function(balls){
        if (renderer){

            camera.position.set(balls[0].x-110,60-balls[0].y,10);
            camera.up.set(0,0,1);
            camera.lookAt(new THREE.Vector3(30*Math.cos(balls[0].angle),30*Math.sin(balls[0].angle),0));
            for (var i=0;i<16;i++) {

                spheres[i].rotation.z = -balls[i].angle;
                spheres[i].position.set(balls[i].x-100, -balls[i].y+50, 3);

            }






            renderer.render(scene,camera)
        }
    }
}

