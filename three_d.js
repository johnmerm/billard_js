

function init3d() {

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(75, 2, 0.1, 1000);
    try {
        var renderer = new THREE.WebGLRenderer();
        if (renderer) {
            renderer.setSize(800, 400);
            document.getElementById('container3d').appendChild(renderer.domElement);

            var geometry = new THREE.SphereGeometry(1, 100, 100, 0, 7, 0, 7);
            var material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
            var cube = new THREE.Mesh(geometry, material);
            scene.add(cube);
            camera.position.z = 5;
        }
    }catch (e){
        console.log("WebGL cannot be init",e);
    }



    return function(){
        if (renderer){
            cube.rotation.x += 0.1;
            cube.rotation.y += 0.1;

            renderer.render(scene,camera)
        }
    }
}

