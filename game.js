// === Realistic Plane Game with OBJ Model Support ===
//
// - Canvas-based 3D wireframe OBJ rendering
// - Bullet drop, plane energy/throttle physics
// - Minimal menu/HUD using logo/thumb

// --------- SETTINGS ----------
const GRAVITY = 0.14;
const BULLET_SPEED = 6;
const BULLET_LIFETIME = 230;
const MAX_THRUST = 1.0, MIN_THRUST = 0.0, MAX_VEL = 3.3, MIN_VEL = 0.7;
const THROTTLE_STEP = 0.008;
const PLANE_RADIUS = 1.8;
const ENERGY_LOSS_PER_CLIMB = 0.014, ENERGY_GAIN_PER_DIVE = 0.011;
const CLIMB_EFFICIENCY = 0.92, DIVE_EFFICIENCY = 0.04;
const TURN_SPEED_BASE = 0.07, PITCH_SPEED_BASE = 0.038;

let canvas = document.getElementById("canvas"),
    ctx = canvas.getContext("2d");
function resize() {
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
}
resize(); window.addEventListener("resize", resize);

// --------- ASSET VARS ---------
let assets = {};
let OBJMODELS = {}, MATERIALS = {};
let logoImg = new Image(), thumbImg = new Image(), crosshairImg = new Image();
logoImg.src = "assets/logo.png";
thumbImg.src = "assets/thumb_blurred.png";
crosshairImg.src = "assets/crosshair.svg";

// --------- GAME STATE ---------
let keys = {};
let mouseDown = false, mouseX = 0, mouseY = 0;
let throttle = 0.7, planeSpeed = 1.5;
let plane = null, enemy = null, bullets = [];
let gameState = "menu";

window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
canvas.addEventListener('mousedown', () => mouseDown = true);
canvas.addEventListener('mouseup', () => mouseDown = false);
canvas.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });

// --------- OBJ Parsing & Mesh Class ---------
function parseOBJ(objText) {
  const lines = objText.split('\n');
  const verts = [], faces = [];
  lines.forEach(line => {
    if(line.startsWith('v ')) {
      verts.push(line.trim().split(/\s+/).slice(1).map(Number));
    }
    if(line.startsWith('f ')) {
      // Faces: indices, convert to 0-based
      const face = line.trim().split(/\s+/).slice(1)
        .map(part => Number(part.split('/')[0]) - 1);
      faces.push(face);
    }
  });
  return {verts, faces};
}

// 3D Transform utilities
function matMulVec(mat, v) {
  return [
    mat[0][0]*v[0] + mat[0][1]*v[1] + mat[0][2]*v[2],
    mat[1][0]*v[0] + mat[1][1]*v[1] + mat[1][2]*v[2],
    mat[2][0]*v[0] + mat[2][1]*v[1] + mat[2][2]*v[2]
  ];
}
function rotMatrix(rx, ry, rz) {
  let [sx,cx,sy,cy,sz,cz] = [Math.sin(rx),Math.cos(rx),Math.sin(ry),Math.cos(ry),Math.sin(rz),Math.cos(rz)];
  // ZYX order
  return [
    [cy*cz, cx*sz+sx*sy*cz, sx*sz-cx*sy*cz],
    [-cy*sz, cx*cz-sx*sy*sz, sx*cz+cx*sy*sz],
    [sy, -sx*cy, cx*cy]
  ];
}
function addVec(a,b) { return [a[0]+b[0],a[1]+b[1],a[2]+b[2]]; }
function subVec(a,b) { return [a[0]-b[0],a[1]-b[1],a[2]-b[2]]; }
function scaleVec(a,s) { return [a[0]*s,a[1]*s,a[2]*s]; }
// Perspective project: simple, assumes camera at [0,0,0], looks -Z
function project3D([x,y,z], fov=800) {
  return [canvas.width/2 + x*fov/(z+20), canvas.height/2 - y*fov/(z+20)];
}

// A mesh instance: model, pos, rot
class Mesh {
  constructor(model, position=[0,0,0], rotation=[0,0,0], scale=1.0) {
    this.model = model; // {verts, faces}
    this.pos = [...position];
    this.rot = [...rotation];
    this.scale = scale;
  }
  transformedVerts() {
    let m = rotMatrix(this.rot[0], this.rot[1], this.rot[2]);
    return this.model.verts.map(p => addVec(matMulVec(m, scaleVec(p, this.scale)), this.pos));
  }
  drawWire(color="#222") {
    let tv = this.transformedVerts();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    this.model.faces.forEach(face => {
      ctx.beginPath();
      let [fx,fy] = project3D(tv[face[0]]);
      ctx.moveTo(fx, fy);
      for(let i=1; i<face.length; ++i) {
        let [tx,ty] = project3D(tv[face[i]]);
        ctx.lineTo(tx,ty);
      }
      ctx.closePath(); ctx.stroke();
    });
  }
}

// --------- GAME INIT ---------
function startGame() {
  // Load OBJ to mesh
  plane = new Mesh(OBJMODELS["plane"], [0,8,0], [0,0,0], 1.0);
  enemy = new Mesh(OBJMODELS["enemy"], [15,8,15], [0,0,0], 1.0);
  bullets = [];
  planeSpeed=1.5; throttle=0.7;
  gameState = "playing";
}

// --------- ASSET LOADING ---------
function loadAllAssets(callback) {
  // Models to load
  const models = ['plane', 'enemy', 'map', 'bullet', 'fire'];
  let loaded = 0;
  models.forEach(name => {
    fetch(`assets/${name}.obj`).then(r=>r.text()).then(txt=>{
      OBJMODELS[name]=parseOBJ(txt); loaded++; if(loaded===models.length) callback();
    }).catch(()=>{OBJMODELS[name]=parseOBJ("");loaded++;if(loaded===models.length)callback();});
  });
}

// --------- MAIN LOOP ---------
function gameLoop() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // MENU
  if(gameState==="menu"){
    ctx.fillStyle="#246";
    ctx.fillRect(0,0,canvas.width,canvas.height);
    if(thumbImg.complete) ctx.drawImage(thumbImg,canvas.width/2-260,50,520,220);
    if(logoImg.complete) ctx.drawImage(logoImg,canvas.width/2-100,300,200,55);
    ctx.font="32px sans-serif"; ctx.fillStyle="#fff";
    ctx.textAlign="center"; ctx.fillText("Plane Game Realistic", canvas.width/2, 400);
    ctx.font="18px sans-serif";
    ctx.fillText("Click to start", canvas.width/2, 450);
    if(mouseDown) { startGame(); }
    requestAnimationFrame(gameLoop);return;
  }

  // PHYSICS: Throttle & rotation
  if(keys['shift']) throttle=Math.min(MAX_THRUST,throttle+THROTTLE_STEP);
  if(keys['control']) throttle=Math.max(MIN_THRUST,throttle-THROTTLE_STEP);
  let climbing=0;
  if(keys['arrowup']||keys['w'])climbing=1;
  else if(keys['arrowdown']||keys['s'])climbing=-1;
  if(climbing===1) planeSpeed-=ENERGY_LOSS_PER_CLIMB*CLIMB_EFFICIENCY;
  else if(climbing===-1)planeSpeed+=ENERGY_GAIN_PER_DIVE*DIVE_EFFICIENCY;
  planeSpeed += (throttle*(MAX_VEL-MIN_VEL)+MIN_VEL-planeSpeed)*0.03;
  planeSpeed = Math.max(MIN_VEL, Math.min(MAX_VEL, planeSpeed));
  // Turn
  let turn = TURN_SPEED_BASE*(planeSpeed/MAX_VEL), pitch=PITCH_SPEED_BASE*(planeSpeed/MAX_VEL);
  if(keys['arrowleft']||keys['a']) plane.rot[2]+=turn;
  if(keys['arrowright']||keys['d']) plane.rot[2]-=turn;
  if(climbing===1)plane.rot[0]-=pitch;
  if(climbing===-1)plane.rot[0]+=pitch;
  // Move (forward in XZ, altitude in Y)
  let dx=Math.sin(plane.rot[2])*planeSpeed, dz=Math.cos(plane.rot[2])*planeSpeed, dy=-Math.sin(plane.rot[0])*(planeSpeed*0.8);
  plane.pos[0]+=dx; plane.pos[1]+=dy; plane.pos[2]+=dz;

  // Fire
  if(keys[' ']&&(!plane.lastShot||Date.now()-plane.lastShot>350)){fireBullet(); plane.lastShot=Date.now();}

  // ENEMY: simple pursuit
  let ex=plane.pos[0]-enemy.pos[0], ez=plane.pos[2]-enemy.pos[2];
  let enemyAngle=Math.atan2(ex, ez);
  enemy.rot[2]+=(enemyAngle-enemy.rot[2])*0.04;
  let enemySpeed=1.8;
  enemy.pos[0]+=Math.sin(enemy.rot[2])*enemySpeed;
  enemy.pos[2]+=Math.cos(enemy.rot[2])*enemySpeed;

  // BULLET UPDATE
  bullets.forEach(b=>b.update());
  bullets=bullets.filter(b=>b.alive);

  // CAMERA: Always behind plane (just a simple world offset for 2D canvas, not 3D yet)
  let screenX=canvas.width/2, screenY=canvas.height/2;
  ctx.save();

  // Draw "ground"
  ctx.fillStyle="#8cbf7a";
  ctx.fillRect(0,screenY+100,canvas.width,canvas.height);

  // Draw models (projected wireframe)
  ctx.save();
  // Translate world such that plane is at center in x/z (topdown)
  ctx.translate(screenX,screenY);
  ctx.save(); ctx.translate(0,170); ctx.scale(1,1.3); // Fake horizon+altitude
  OBJMODELS["map"] && new Mesh(OBJMODELS["map"],subVec([0,0,0], [plane.pos[0],0,plane.pos[2]]),[0,0,0],1).drawWire("#888");
  ctx.restore();
  // Plane
  new Mesh(plane.model, [0,0,0],[...plane.rot],1.4).drawWire("#44f");
  // Enemy (offset relative to plane)
  let enemyDx=enemy.pos[0]-plane.pos[0], enemyDz=enemy.pos[2]-plane.pos[2];
  new Mesh(enemy.model, [enemyDx,0,enemyDz],[...enemy.rot],1.1).drawWire("#e33");
  // Bullets (projected as points/lines)
  ctx.strokeStyle="#111";
  bullets.forEach(b=>{
    let bx=b.pos[0]-plane.pos[0], by=b.pos[1]-plane.pos[1], bz=b.pos[2]-plane.pos[2];
    let [sx,sz]=[bx*14,bz*12];
    ctx.beginPath(); ctx.arc(sx,-by*10+16,2,0,Math.PI*2); ctx.stroke();
  });
  ctx.restore();
  ctx.restore();

  // HUD
  ctx.fillStyle="rgba(40,40,40,0.8)";
  ctx.fillRect(8,8,186,44);
  ctx.fillStyle="#fff";
  ctx.font="16px monospace"; ctx.textAlign="left";
  ctx.fillText("Throttle: "+(throttle*100|0)+"%", 18,28);
  ctx.fillText("Speed: "+planeSpeed.toFixed(2), 18,48);
  ctx.font="12px Arial";
  ctx.fillText("SHIFT/CTRL=throttle, arrows/WASD=fly, SPACE=Fire, Click=Menu", 10, canvas.height-12);

  requestAnimationFrame(gameLoop);
}

// --------- BULLET FIRING ---------
function fireBullet(){
  // Fire forward
  let dir=[Math.sin(plane.rot[2])*Math.cos(plane.rot[0]),-Math.sin(plane.rot[0]),Math.cos(plane.rot[2])*Math.cos(plane.rot[0])];
  let bulletVel=dir.map(v=>v*BULLET_SPEED);
  let pos=[plane.pos[0]+dir[0]*2, plane.pos[1]+dir[1]*2, plane.pos[2]+dir[2]*2];
  bullets.push(new BulletObj(pos, bulletVel));
}
class BulletObj {
  constructor(pos, vel){this.pos=[...pos];this.vel=[...vel];this.alive=true;this.time=0;}
  update(){ this.vel[1]-=GRAVITY; this.pos=this.pos.map((x,i)=>x+this.vel[i]); this.time++; if(this.time>BULLET_LIFETIME)this.alive=false;}
}

// --------- START ---------
loadAllAssets(()=>{
  gameLoop();
});
