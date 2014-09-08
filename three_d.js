var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(75, 2, 0.1, 1000);
var renderer = new THREE.WebGLRenderer();
var cube;

function init3d() {



    renderer.setSize(800, 400);
    document.getElementById('container3d').appendChild(renderer.domElement);

    var geometry = new THREE.SphereGeometry(1,100,100,0,7,0,7);
    var material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    cube = new THREE.Mesh(geometry, material);
    scene.add(cube);
    camera.position.z = 5;
}

