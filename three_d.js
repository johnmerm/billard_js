

function init3d() {

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(90, 2, 1, 100);

    var planeCamera = new THREE.PerspectiveCamera(75,2,1,100);
    planeCamera.position.set(0,0,70);

    try {
        var renderer = new THREE.WebGLRenderer();
       // var planeRenderer = new THREE.WebGLRenderer();

        if (renderer) {
            renderer.setSize(800, 400);
            //planeRenderer.setSize(800,400);
            document.getElementById('container3d').appendChild(renderer.domElement);
            //document.getElementById('container3d').appendChild(planeRenderer.domElement);

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

    //An arrow in fron of white
    var geometry = new THREE.Geometry();
    geometry.vertices.push(new THREE.Vector3(0, -10, 0));
    geometry.vertices.push(new THREE.Vector3(10, 0, 0));
    geometry.vertices.push(new THREE.Vector3(0, 10, 0));


    var line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
        color: 0x0000ff
    }));

    scene.add(line);

    //walls
    var hWallGeometry = new THREE.BoxGeometry((edge - 4 * radius) , wall / 2,5);
    var wallMaterial  = new THREE.MeshBasicMaterial({color:0xD2691E});

    var hWalls = new THREE.Mesh(hWallGeometry,wallMaterial);
    hWalls.position.set(edge / 2 + radius / 2-100, 50-wall / 2,0);
    scene.add(hWalls);

    hWalls = new THREE.Mesh(hWallGeometry,wallMaterial);
    hWalls.position.set(3* edge / 2 + radius / 2-100, 50-wall / 2,0);


    scene.add(hWalls);

    hWalls = new THREE.Mesh(hWallGeometry,wallMaterial);
    hWalls.position.set(edge / 2 + radius / 2-100, 50-edge+wall / 2,0);
    scene.add(hWalls);

    hWalls = new THREE.Mesh(hWallGeometry,wallMaterial);
    hWalls.position.set(3* edge / 2 + radius / 2-100, 50-edge+wall / 2,0);

    scene.add(hWalls);


    var vWallGeometry = new THREE.BoxGeometry(wall / 2,edge - 4 * radius,5);
    var vWalls = new THREE.Mesh(vWallGeometry,wallMaterial);
    vWalls.position.set(wall/2-100,0,0);
    scene.add(vWalls);

    vWalls = new THREE.Mesh(vWallGeometry,wallMaterial);
    vWalls.position.set(2 * edge - wall / 2 -100 , 50-edge / 2,0);
    scene.add(vWalls);

    return function(balls){
        if (renderer){

           camera.position.set(balls[0].x-100,50-balls[0].y,6);
           camera.up.set(0,0,1);
           camera.lookAt(new THREE.Vector3(balls[0].x-100+balls[0].v.x,50-balls[0].y-balls[0].v.y,6));

            line.position.set(balls[0].x-100, -balls[0].y+50, 3);
            line.rotation.z = -balls[0].angle;
            for (var i=0;i<16;i++) {

                spheres[i].rotation.z = -balls[i].angle;
                spheres[i].position.set(balls[i].x-100, -balls[i].y+50, 3);

            }






            renderer.render(scene,camera);
            //planeRenderer.render(scene,planeCamera);
        }
    }
}

