var colors = ['white', 'Yellow', 'Blue', 'Red', 'Purple', 'Orange', 'Lime', 'SaddleBrown', 'Black'];


var pats=[];

var cv = document.createElement('canvas');
var ctx = cv.getContext('2d');



for (var i=0;i<9;i++){
    var c = colors[i];



    ctx.fillStyle=c;
    ctx.rect(0,0,24,24);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(12,12,6,0,6.28);
    ctx.fillStyle="white";
    ctx.fill();

    ctx.fillStyle=c;
    ctx.font = "8pt Arial";
    ctx.textAllign="center";
    ctx.textBaseline="middle";
    ctx.fillText(''+i,9.5,12);

    var texture = cv.toDataURL();

    var img = document.createElement('img');
    img.src=texture;




    pats.push(img);
}

for (var i=1;i<8;i++){
    var c = colors[i];

    var ctx = cv.getContext('2d');

    ctx.fillStyle=c;

    ctx.beginPath();
    ctx.rect(0,0,24,8);
    ctx.fill();


    ctx.fillStyle='White';
    ctx.beginPath();
    ctx.rect(0,6,24,18);
    ctx.fill();

    ctx.fillStyle=c;
    ctx.beginPath();
    ctx.rect(0,18,24,24);
    ctx.fill();

    ctx.fillStyle=c;
    ctx.font = "8pt Arial";
    ctx.textAllign="center";
    ctx.textBaseline="middle";
    ctx.fillText(''+(8+i),9.5,12);

    var texture = cv.toDataURL();
    var img = document.createElement('img');
    img.src=texture;




    pats.push(img);
}

