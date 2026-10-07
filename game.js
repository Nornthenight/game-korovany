/**
 * СУТЬ ТАКОВА: 3D Экшон (Three.js WebGL Engine)
 * Реализация:
 * 1. 4 зоны (Люди, Дворец Императора, Эльфийский Лес, Форт Злодея в горах).
 * 2. 3 фракции (Лесные эльфы, Охрана дворца, Злодей).
 * 3. LOD-деревья: на дистанции >45m - 2D билборд-картинка, вблизи <45m - 3D меш.
 * 4. Корованы: караваны с верблюдами/вьючными животными и охраной, которые можно грабить.
 * 5. Расчленёнка и увечья:
 *    - Выколотый глаз (затемнение половины экрана),
 *    - Отрубленная рука (нельзя бить двуручным оружием + кровопотеря),
 *    - Потеря ноги (ползание или инвалидная коляска),
 *    - Покупка протезов и лечение в стиле Daggerfall.
 * 6. 3D-трупы поверженных врагов.
 * 7. F5 (быстрое сохранение) и F9 (быстрая загрузка).
 */

// --- СОСТОЯНИЕ ИГРОКА И МИРА ---
const GameState = {
  player: {
    hp: 100,
    maxHp: 100,
    gold: 250,
    faction: 'elves', // 'elves' | 'guards' | 'villain'
    position: new THREE.Vector3(0, 2, 0),
    rotation: new THREE.Euler(0, 0, 0, 'YXZ'),
    speed: 0.25,
    crawling: false, // ползание при потере ноги
    hasWheelchair: false, // коляска
    limbs: {
      eye: 'ok',       // 'ok' | 'damaged' | 'prosthetic'
      arm: 'ok',       // 'ok' | 'damaged' | 'prosthetic'
      leg: 'ok'        // 'ok' | 'damaged' | 'prosthetic'
    },
    bleeding: false,
    weapon: 'iron_sword'
  },
  villainArmyState: 'follow', // 'follow' | 'attack_palace' | 'raid_elves'
  korovansRobbed: 0,
  guardsKilled: 0
};

// Зоны мира (координаты X, Z)
const ZONES = {
  NEUTRAL: { name: 'Зона Людей (Нейтрал)', center: new THREE.Vector2(0, 0), radius: 60, color: 0x4a7c59 },
  PALACE:  { name: 'Императорский Дворец', center: new THREE.Vector2(120, 0), radius: 60, color: 0x8a9ba8 },
  ELVES:   { name: 'Эльфийский Лес',     center: new THREE.Vector2(-120, 0), radius: 60, color: 0x1b4332 },
  VILLAIN: { name: 'Горы и Форт Злодея', center: new THREE.Vector2(0, 120), radius: 60, color: 0x3d2645 }
};

// --- СЦЕНА, КАМЕРА, РЕНДЕРЕР ---
let scene, camera, renderer;
let clock = new THREE.Clock();

// Управление от первого лица (Pointer Lock)
let isLocked = false;
const moveState = { forward: false, backward: false, left: false, right: false, jump: false };
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
let canJump = true;
let pitchObject = new THREE.Object3D();
let yawObject = new THREE.Object3D();

// Сущности мира
let treeEntities = []; // Объекты деревьев с LOD
let npcs = [];         // Живые NPC (охрана, эльфы, орки)
let corpses = [];      // 3D-трупы
let korovans = [];     // Корованы
let shops = [];        // Торговые палатки

// Web Audio API синтезатор для звуков
let audioCtx = null;
function playSound(type) {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  const now = audioCtx.currentTime;

  if (type === 'hit') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.15);
    osc.start(now);
    osc.stop(now + 0.15);
  } else if (type === 'rob') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.linearRampToValueAtTime(600, now + 0.1);
    osc.frequency.linearRampToValueAtTime(900, now + 0.25);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  } else if (type === 'hurt') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.linearRampToValueAtTime(80, now + 0.3);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  } else if (type === 'buy') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.setValueAtTime(659.25, now + 0.08);
    osc.frequency.setValueAtTime(783.99, now + 0.16);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.25);
    osc.start(now);
    osc.stop(now + 0.25);
  }
}

// --- ИНИЦИАЛИЗАЦИЯ ИГРЫ ---
function init() {
  const container = document.getElementById('game-container');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // Небо
  scene.fog = new THREE.FogExp2(0x87ceeb, 0.008);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  pitchObject.add(camera);
  yawObject.position.y = 2;
  yawObject.add(pitchObject);
  scene.add(yawObject);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Освещение
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xfff5e6, 0.85);
  sunLight.position.set(60, 120, 50);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 400;
  sunLight.shadow.camera.left = -150;
  sunLight.shadow.camera.right = 150;
  sunLight.shadow.camera.top = 150;
  sunLight.shadow.camera.bottom = -150;
  scene.add(sunLight);

  // Генерация мира (Ландшафт, 4 зоны, постройки, корованы, деревья)
  createWorldTerrain();
  createNeutralVillage();
  createImperialPalace();
  createElvenForest();
  createVillainFort();
  spawnKorovans();
  spawnNpcs();

  setupControls();
  setupUI();
  setupShopData();

  window.addEventListener('resize', onWindowResize, false);

  // Старт игрового цикла
  animate();
}

// --- СОЗДАНИЕ ЛАНДШАФТА 4 ЗОН ---
function createWorldTerrain() {
  // Общий пол
  const groundGeo = new THREE.PlaneGeometry(600, 600, 80, 80);
  groundGeo.rotateX(-Math.PI / 2);

  // Делаем рельеф: горы на севере (зона злодея), холмы
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let y = 0;
    // Горы злодея (z > 50)
    if (z > 40) {
      const dist = z - 40;
      y = Math.sin(x * 0.05) * 6 + Math.cos(z * 0.05) * 8 + (dist * 0.4);
    } else {
      // Легкие волны
      y = Math.sin(x * 0.04) * 0.8 + Math.cos(z * 0.04) * 0.8;
    }
    pos.setY(i, y);
  }
  groundGeo.computeVertexNormals();

  // Создаем процедурную текстуру травы/камня с цветными зонами
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#4a7c59'; // Нейтральная трава
  ctx.fillRect(0, 0, 512, 512);

  // Зона эльфов (зеленый мох)
  ctx.fillStyle = '#1b4332';
  ctx.fillRect(0, 150, 180, 212);

  // Зона дворца (плитка/мрамор)
  ctx.fillStyle = '#7f8c8d';
  ctx.fillRect(332, 150, 180, 212);

  // Зона злодея (темный вулканический камень)
  ctx.fillStyle = '#2c1e21';
  ctx.fillRect(150, 332, 212, 180);

  // Дороги тракта корованов
  ctx.strokeStyle = '#c4a482';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(0, 256);
  ctx.lineTo(512, 256); // С запада на восток через центр
  ctx.stroke();

  const terrainTex = new THREE.CanvasTexture(canvas);
  terrainTex.wrapS = THREE.RepeatWrapping;
  terrainTex.wrapT = THREE.RepeatWrapping;

  const groundMat = new THREE.MeshLambertMaterial({ map: terrainTex });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);
}

// --- 1. НЕЙТРАЛЬНЫЕ ЗЕМЛИ: ДЕРЕВНЯ И ТОРГОВАЯ ЛАВКА ---
function createNeutralVillage() {
  // Дома торговцев
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const hx = Math.cos(angle) * 22;
    const hz = Math.sin(angle) * 22;

    const house = createMedievalHouse(0xd2b48c, 0x8b4513);
    house.position.set(hx, 0, hz);
    scene.add(house);
  }

  // Центральный лагерь торговцев Daggerfall
  const shopStand = new THREE.Group();
  const standGeo = new THREE.BoxGeometry(4, 1.2, 2);
  const standMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
  const stand = new THREE.Mesh(standGeo, standMat);
  stand.position.y = 0.6;
  stand.castShadow = true;
  shopStand.add(stand);

  // Навес
  const canopyGeo = new THREE.ConeGeometry(3.5, 1.5, 4);
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0xc0392b });
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.y = 2.8;
  shopStand.add(canopy);

  // Продавец (NPC лекарь-кузнец)
  const trader = createHumanoidMesh(0x34495e, 0xf39c12);
  trader.position.set(0, 0, -1.2);
  shopStand.add(trader);

  shopStand.position.set(0, 0, 0);
  scene.add(shopStand);

  shops.push({
    position: new THREE.Vector3(0, 0, 0),
    radius: 5,
    name: "Торговец Лекарь-Протезист"
  });
}

// --- 2. ИМПЕРАТОРСКИЙ ДВОРЕЦ С КОМАНДИРОМ ---
function createImperialPalace() {
  const palaceGroup = new THREE.Group();
  palaceGroup.position.set(120, 0, 0);

  // Главное здание дворца
  const mainGeo = new THREE.BoxGeometry(30, 16, 24);
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xdcdde1, roughness: 0.6 });
  const palace = new THREE.Mesh(mainGeo, stoneMat);
  palace.position.y = 8;
  palace.castShadow = true;
  palace.receiveShadow = true;
  palaceGroup.add(palace);

  // Башни
  const towerGeo = new THREE.CylinderGeometry(3.5, 4, 24, 12);
  const roofGeo = new THREE.ConeGeometry(4.5, 6, 12);
  const goldRoofMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f, metalness: 0.5, roughness: 0.3 });

  const towerOffsets = [
    [-15, -12], [15, -12], [-15, 12], [15, 12]
  ];
  towerOffsets.forEach(([ox, oz]) => {
    const tower = new THREE.Mesh(towerGeo, stoneMat);
    tower.position.set(ox, 12, oz);
    tower.castShadow = true;
    const roof = new THREE.Mesh(roofGeo, goldRoofMat);
    roof.position.set(ox, 27, oz);
    roof.castShadow = true;
    palaceGroup.add(tower);
    palaceGroup.add(roof);
  });

  // Ворота
  const gateGeo = new THREE.BoxGeometry(6, 8, 2);
  const gateMat = new THREE.MeshStandardMaterial({ color: 0x4a3728 });
  const gate = new THREE.Mesh(gateGeo, gateMat);
  gate.position.set(-15, 4, 0);
  palaceGroup.add(gate);

  // Командир стражи на входе
  const commander = createHumanoidMesh(0xf39c12, 0xe74c3c, true);
  commander.position.set(-19, 0, 0);
  commander.userData = { isCommander: true, name: "Командир Императорской Стражи" };
  palaceGroup.add(commander);

  scene.add(palaceGroup);
}

// --- 3. ЭЛЬФИЙСКИЙ ЛЕС: ДЕРЕВЯННЫЕ ДОМИКИ И LOD ДЕРЕВЬЯ ---
function createElvenForest() {
  const forestCenter = new THREE.Vector3(-120, 0, 0);

  // Деревянные домики эльфов
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2;
    const hx = forestCenter.x + Math.cos(ang) * 25 + (Math.random() - 0.5) * 8;
    const hz = forestCenter.z + Math.sin(ang) * 25 + (Math.random() - 0.5) * 8;

    const elvenHouse = createWoodenCabin();
    elvenHouse.position.set(hx, 0, hz);
    elvenHouse.rotation.y = Math.random() * Math.PI;
    scene.add(elvenHouse);
  }

  // Генерация деревьев с реализацией LOD:
  // "Вдали деревья картинкой, когда подходиш они преобразовываются в 3-хмерные деревья"
  for (let i = 0; i < 65; i++) {
    const rx = forestCenter.x + (Math.random() - 0.5) * 110;
    const rz = forestCenter.z + (Math.random() - 0.5) * 110;

    // Не спавнить прямо поверх домиков
    if (forestCenter.distanceTo(new THREE.Vector3(rx, 0, rz)) < 8) continue;

    const lodTree = createLODTree(rx, rz);
    treeEntities.push(lodTree);
    scene.add(lodTree.root);
  }
}

// --- 4. ЗОНА ЗЛОДЕЯ: СТАРЫЙ ФОРТ В ГОРАХ ---
function createVillainFort() {
  const fortGroup = new THREE.Group();
  fortGroup.position.set(0, 15, 120);

  // Стены старого форта
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2d3436, roughness: 0.9 });
  const wallGeo1 = new THREE.BoxGeometry(35, 8, 3);
  const wallGeo2 = new THREE.BoxGeometry(3, 8, 35);

  const w1 = new THREE.Mesh(wallGeo1, wallMat); w1.position.set(0, 4, -16);
  const w2 = new THREE.Mesh(wallGeo1, wallMat); w2.position.set(0, 4, 16);
  const w3 = new THREE.Mesh(wallGeo2, wallMat); w3.position.set(-16, 4, 0);
  const w4 = new THREE.Mesh(wallGeo2, wallMat); w4.position.set(16, 4, 0);

  fortGroup.add(w1, w2, w3, w4);

  // Тронный зал Злодея
  const throneGeo = new THREE.BoxGeometry(4, 6, 3);
  const throneMat = new THREE.MeshStandardMaterial({ color: 0x9b59b6 });
  const throne = new THREE.Mesh(throneGeo, throneMat);
  throne.position.set(0, 3, 10);
  fortGroup.add(throne);

  // Факелы со зловещим огнем
  for (let side of [-8, 8]) {
    const torchGeo = new THREE.CylinderGeometry(0.3, 0.3, 3);
    const torchMat = new THREE.MeshLambertMaterial({ color: 0x333 });
    const torch = new THREE.Mesh(torchGeo, torchMat);
    torch.position.set(side, 3, 8);

    const flameLight = new THREE.PointLight(0xe74c3c, 1.5, 15);
    flameLight.position.set(side, 4.8, 8);
    fortGroup.add(torch);
    fortGroup.add(flameLight);
  }

  scene.add(fortGroup);
}

// --- СИСТЕМА КОРОВАНОВ (ГРАБЕЖ КОРОВАНОВ) ---
function spawnKorovans() {
  // Корован состоит из вьючных животных (верблюды/мулы с тюками золота) и охраны
  for (let k = 0; k < 2; k++) {
    const korovanGroup = new THREE.Group();
    korovanGroup.userData = {
      isKorovan: true,
      gold: 350 + Math.floor(Math.random() * 250),
      robbable: true,
      direction: k === 0 ? 1 : -1,
      speed: 0.08
    };

    // Вьючные верблюды с поклажей
    for (let c = 0; c < 3; c++) {
      const camel = createCamelMesh();
      camel.position.set(c * 6 - 6, 0, 0);
      korovanGroup.add(camel);
    }

    // Охрана корована (2 охранника на флангах)
    const guard1 = createHumanoidMesh(0x2980b9, 0xbdc3c7);
    guard1.position.set(0, 0, 3);
    korovanGroup.add(guard1);

    const guard2 = createHumanoidMesh(0x2980b9, 0xbdc3c7);
    guard2.position.set(4, 0, -3);
    korovanGroup.add(guard2);

    korovanGroup.position.set(-100 + k * 120, 0, 0);
    scene.add(korovanGroup);
    korovans.push(korovanGroup);
  }
}

// Вьючное животное (верблюд/осел) с грузом золота
function createCamelMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xc29b61 });

  // Тело
  const body = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2, 1.8), mat);
  body.position.y = 2.2;
  body.castShadow = true;
  g.add(body);

  // Горб
  const hump = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.4, 6), mat);
  hump.position.set(0, 3.8, 0);
  g.add(hump);

  // Тюки с золотом/товарами по бокам
  const packMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.4 });
  const pack1 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.8), packMat);
  pack1.position.set(0.2, 2.5, 1.1);
  const pack2 = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 0.8), packMat);
  pack2.position.set(0.2, 2.5, -1.1);
  g.add(pack1, pack2);

  // Ноги
  const legGeo = new THREE.BoxGeometry(0.5, 1.6, 0.5);
  [[-1.2, -0.6], [1.2, -0.6], [-1.2, 0.6], [1.2, 0.6]].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(legGeo, mat);
    leg.position.set(lx, 0.8, lz);
    g.add(leg);
  });

  return g;
}

// --- СПАВН ДРУГИХ NPC (Эльфы, Солдаты Дворца, Войска Злодея) ---
function spawnNpcs() {
  // Солдаты охраны дворца
  for (let i = 0; i < 5; i++) {
    const g = createNpcEntity('guards', new THREE.Vector3(100 + Math.random() * 20, 0, (Math.random() - 0.5) * 30));
    npcs.push(g);
  }

  // Лесные эльфы в лесу
  for (let i = 0; i < 5; i++) {
    const e = createNpcEntity('elves', new THREE.Vector3(-110 + Math.random() * 20, 0, (Math.random() - 0.5) * 30));
    npcs.push(e);
  }

  // Войска злодея (в горах)
  for (let i = 0; i < 6; i++) {
    const v = createNpcEntity('villain', new THREE.Vector3((Math.random() - 0.5) * 20, 15, 110 + Math.random() * 20));
    npcs.push(v);
  }
}

function createNpcEntity(faction, pos) {
  let bodyColor = 0x27ae60; // Эльфы
  let armorColor = 0x2ecc71;
  let name = "Эльф-партизан";

  if (faction === 'guards') {
    bodyColor = 0x2980b9;
    armorColor = 0xf39c12;
    name = "Солдат Дворца";
  } else if (faction === 'villain') {
    bodyColor = 0x8e44ad;
    armorColor = 0xc0392b;
    name = "Воин Злодея";
  }

  const mesh = createHumanoidMesh(bodyColor, armorColor);
  mesh.position.copy(pos);
  scene.add(mesh);

  return {
    faction: faction,
    name: name,
    mesh: mesh,
    hp: 45,
    maxHp: 45,
    speed: 0.12,
    target: null,
    alive: true
  };
}

// Построение 3D-гуманоида (персонаж/враг)
function createHumanoidMesh(bodyColor, armorColor, isCommander = false) {
  const g = new THREE.Group();
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
  const clothMat = new THREE.MeshLambertMaterial({ color: bodyColor });
  const armorMat = new THREE.MeshStandardMaterial({ color: armorColor });

  // Туловище
  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 0.7), armorMat);
  torso.position.y = 2.0;
  torso.castShadow = true;
  g.add(torso);

  // Голова
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), skinMat);
  head.position.y = 3.2;
  head.castShadow = true;
  g.add(head);

  if (isCommander) {
    // Шлем с плюмажем у командира
    const helmet = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 6), new THREE.MeshStandardMaterial({ color: 0xf1c40f }));
    helmet.position.y = 3.8;
    g.add(helmet);
  }

  // Руки с оружием
  const armGeo = new THREE.BoxGeometry(0.4, 1.2, 0.4);
  const leftArm = new THREE.Mesh(armGeo, clothMat);
  leftArm.position.set(-0.85, 2.0, 0);
  const rightArm = new THREE.Mesh(armGeo, clothMat);
  rightArm.position.set(0.85, 2.0, 0);
  g.add(leftArm, rightArm);

  // Оружие в правой руке (меч)
  const swordGeo = new THREE.BoxGeometry(0.15, 1.8, 0.3);
  const swordMat = new THREE.MeshStandardMaterial({ color: 0xdfe6e9, metalness: 0.8 });
  const sword = new THREE.Mesh(swordGeo, swordMat);
  sword.position.set(0.85, 1.6, 0.6);
  sword.rotation.x = Math.PI / 4;
  g.add(sword);

  // Ноги
  const legGeo = new THREE.BoxGeometry(0.45, 1.4, 0.45);
  const leftLeg = new THREE.Mesh(legGeo, clothMat);
  leftLeg.position.set(-0.35, 0.7, 0);
  const rightLeg = new THREE.Mesh(legGeo, clothMat);
  rightLeg.position.set(0.35, 0.7, 0);
  g.add(leftLeg, rightLeg);

  return g;
}

// --- ФИРМЕННАЯ LOD-СИСТЕМА ДЕРЕВЬЕВ ---
// "вдали деревья картинкой, когда подходиш они преобразовываются в 3-хмерные деревья"
function createLODTree(x, z) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);

  // 1. БЛИЖНИЙ 3D-МЕШ (ствол + ветви/крона)
  const mesh3D = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 5, 8);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5c4033 });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 2.5;
  trunk.castShadow = true;
  mesh3D.add(trunk);

  // Крона из 3 сфер
  const leavesMat = new THREE.MeshLambertMaterial({ color: 0x2d6a4f });
  const c1 = new THREE.Mesh(new THREE.DodecahedronGeometry(2.6, 1), leavesMat);
  c1.position.y = 5.2;
  const c2 = new THREE.Mesh(new THREE.DodecahedronGeometry(2.2, 1), leavesMat);
  c2.position.set(0.5, 6.8, 0.2);
  const c3 = new THREE.Mesh(new THREE.DodecahedronGeometry(1.6, 1), leavesMat);
  c3.position.set(-0.4, 8.2, -0.3);
  mesh3D.add(c1, c2, c3);

  // 2. ДАЛЬНИЙ 2D-БИЛБОРД (плоская картинка дерева, поворачивающаяся к камере)
  const billboardCanvas = document.createElement('canvas');
  billboardCanvas.width = 128;
  billboardCanvas.height = 128;
  const bctx = billboardCanvas.getContext('2d');

  // Рисуем ствол
  bctx.fillStyle = '#5c4033';
  bctx.fillRect(56, 75, 16, 50);
  // Рисуем крону (зеленый круг)
  bctx.fillStyle = '#2d6a4f';
  bctx.beginPath();
  bctx.arc(64, 45, 42, 0, Math.PI * 2);
  bctx.fill();
  bctx.fillStyle = '#40916c';
  bctx.beginPath();
  bctx.arc(60, 40, 28, 0, Math.PI * 2);
  bctx.fill();

  const spriteTex = new THREE.CanvasTexture(billboardCanvas);
  const spriteMat = new THREE.SpriteMaterial({ map: spriteTex });
  const sprite2D = new THREE.Sprite(spriteMat);
  sprite2D.position.y = 5;
  sprite2D.scale.set(8, 10, 1);

  root.add(mesh3D);
  root.add(sprite2D);

  // Изначально включен billboard, 3D скрыт
  mesh3D.visible = false;
  sprite2D.visible = true;

  return {
    root: root,
    pos: new THREE.Vector3(x, 0, z),
    mesh3D: mesh3D,
    sprite2D: sprite2D,
    is3D: false
  };
}

// Деревянный домик эльфов
function createWoodenCabin() {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x4a7c59 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6), woodMat);
  body.position.y = 2;
  body.castShadow = true;
  g.add(body);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(5.2, 3, 4), roofMat);
  roof.position.y = 5.5;
  roof.rotation.y = Math.PI / 4;
  g.add(roof);

  return g;
}

// Обычный дом для нейтральной деревни
function createMedievalHouse(wallCol, roofCol) {
  const g = new THREE.Group();
  const wMat = new THREE.MeshLambertMaterial({ color: wallCol });
  const rMat = new THREE.MeshLambertMaterial({ color: roofCol });

  const body = new THREE.Mesh(new THREE.BoxGeometry(7, 5, 7), wMat);
  body.position.y = 2.5;
  body.castShadow = true;
  g.add(body);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(6, 3.5, 4), rMat);
  roof.position.y = 6.2;
  roof.rotation.y = Math.PI / 4;
  g.add(roof);

  return g;
}

// --- УПРАВЛЕНИЕ (WASD, Мышь, Прыжки, Атака) ---
function setupControls() {
  const blocker = document.getElementById('blocker');
  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

  if (isTouchDevice) {
    // На мобильных устройствах не требуется Pointer Lock браузера
    isLocked = true;
    blocker.classList.add('hidden');
    const hint = document.getElementById('controls-hint');
    if (hint) hint.innerText = "Джойстик слева: Ходьба | Справа: Обзор | ⚔️ Атака | 🦘 Прыжок | 🖐️ Действие";
  }

  blocker.addEventListener('click', () => {
    if (!isTouchDevice) {
      document.body.requestPointerLock();
    } else {
      isLocked = true;
      blocker.classList.add('hidden');
    }
  });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === document.body) {
      isLocked = true;
      blocker.classList.add('hidden');
    } else if (!isTouchDevice) {
      isLocked = false;
      blocker.classList.remove('hidden');
    }
  });

  document.addEventListener('mousemove', (event) => {
    if (!isLocked) return;
    const movementX = event.movementX || 0;
    const movementY = event.movementY || 0;

    yawObject.rotation.y -= movementX * 0.0022;
    pitchObject.rotation.x -= movementY * 0.0022;
    pitchObject.rotation.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitchObject.rotation.x));
  });

  document.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'KeyW': moveState.forward = true; break;
      case 'KeyS': moveState.backward = true; break;
      case 'KeyA': moveState.left = true; break;
      case 'KeyD': moveState.right = true; break;
      case 'Space':
        // Прыгать нельзя, если нет ноги и нет протеза (ползание!)
        if (canJump && GameState.player.limbs.leg !== 'damaged') {
          velocity.y = 0.28;
          canJump = false;
        }
        break;
      case 'KeyE':
        handleInteraction();
        break;
      case 'Digit1':
        setVillainArmyOrder('follow');
        break;
      case 'Digit2':
        setVillainArmyOrder('attack_palace');
        break;
      case 'Digit3':
        setVillainArmyOrder('raid_elves');
        break;
      case 'F5':
        e.preventDefault();
        saveGame();
        break;
      case 'F9':
        e.preventDefault();
        loadGame();
        break;
    }
  });

  document.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'KeyW': moveState.forward = false; break;
      case 'KeyS': moveState.backward = false; break;
      case 'KeyA': moveState.left = false; break;
      case 'KeyD': moveState.right = false; break;
    }
  });

  // Атака на ЛКМ
  document.addEventListener('mousedown', (e) => {
    if (e.button === 0 && isLocked) {
      performAttack();
    }
  });

  // Сенсорное управление для мобильных устройств (джойстик и кнопки)
  setupTouchListeners();
}

function setupTouchListeners() {
  const joystickZone = document.getElementById('touch-joystick-zone');
  const knob = document.getElementById('touch-joystick-knob');
  let touchId = null;
  let startX = 0, startY = 0;

  if (joystickZone) {
    joystickZone.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      touchId = t.identifier;
      const rect = joystickZone.getBoundingClientRect();
      startX = rect.left + rect.width / 2;
      startY = rect.top + rect.height / 2;
    }, { passive: false });

    joystickZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (let t of e.changedTouches) {
        if (t.identifier === touchId) {
          const dx = t.clientX - startX;
          const dy = t.clientY - startY;
          const dist = Math.min(45, Math.hypot(dx, dy));
          const angle = Math.atan2(dy, dx);

          const kx = Math.cos(angle) * dist;
          const ky = Math.sin(angle) * dist;
          knob.style.transform = `translate(${kx}px, ${ky}px)`;

          moveState.forward = dy < -12;
          moveState.backward = dy > 12;
          moveState.left = dx < -12;
          moveState.right = dx > 12;
        }
      }
    }, { passive: false });

    const resetJoystick = (e) => {
      for (let t of e.changedTouches) {
        if (t.identifier === touchId) {
          touchId = null;
          knob.style.transform = 'translate(0px, 0px)';
          moveState.forward = false;
          moveState.backward = false;
          moveState.left = false;
          moveState.right = false;
        }
      }
    };
    joystickZone.addEventListener('touchend', resetJoystick);
    joystickZone.addEventListener('touchcancel', resetJoystick);
  }

  // Обзор касанием по правой половине экрана
  let lookTouchId = null;
  let lastLookX = 0, lastLookY = 0;
  window.addEventListener('touchstart', (e) => {
    for (let t of e.changedTouches) {
      if (t.clientX > window.innerWidth / 2 && lookTouchId === null) {
        lookTouchId = t.identifier;
        lastLookX = t.clientX;
        lastLookY = t.clientY;
      }
    }
  });

  window.addEventListener('touchmove', (e) => {
    for (let t of e.changedTouches) {
      if (t.identifier === lookTouchId) {
        const dx = t.clientX - lastLookX;
        const dy = t.clientY - lastLookY;
        yawObject.rotation.y -= dx * 0.006;
        pitchObject.rotation.x -= dy * 0.006;
        pitchObject.rotation.x = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitchObject.rotation.x));
        lastLookX = t.clientX;
        lastLookY = t.clientY;
      }
    }
  });

  const resetLook = (e) => {
    for (let t of e.changedTouches) {
      if (t.identifier === lookTouchId) lookTouchId = null;
    }
  };
  window.addEventListener('touchend', resetLook);
  window.addEventListener('touchcancel', resetLook);

  // Сенсорные кнопки: Атака, Прыжок, Взаимодействие
  const btnAttack = document.getElementById('touch-btn-attack');
  if (btnAttack) btnAttack.addEventListener('touchstart', (e) => { e.preventDefault(); performAttack(); });

  const btnJump = document.getElementById('touch-btn-jump');
  if (btnJump) btnJump.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (canJump && GameState.player.limbs.leg !== 'damaged') {
      velocity.y = 0.28;
      canJump = false;
    }
  });

  const btnAction = document.getElementById('touch-btn-action');
  if (btnAction) btnAction.addEventListener('touchstart', (e) => { e.preventDefault(); handleInteraction(); });
}

// Атака игрока
function performAttack() {
  playSound('hit');

  // Анимация взмаха (простой наклон питча камеры на долю секунды)
  pitchObject.rotation.x += 0.05;
  setTimeout(() => { pitchObject.rotation.x -= 0.05; }, 80);

  // Проверка попадания по NPC / Корованам перед игроком
  const raycaster = new THREE.Raycaster();
  const centerCoord = new THREE.Vector2(0, 0);
  raycaster.setFromCamera(centerCoord, camera);

  // 1. Проверка корованов
  for (let k of korovans) {
    if (k.userData.robbable && yawObject.position.distanceTo(k.position) < 14) {
      robKorovan(k);
      return;
    }
  }

  // 2. Проверка NPC
  for (let npc of npcs) {
    if (!npc.alive) continue;
    if (yawObject.position.distanceTo(npc.mesh.position) < 6) {
      damageNpc(npc, 25);
      return;
    }
  }
}

// Ограбление корована
function robKorovan(k) {
  k.userData.robbable = false;
  const gainedGold = k.userData.gold;
  GameState.player.gold += gainedGold;
  GameState.korovansRobbed++;
  playSound('rob');

  showBanner(`КОРОВАН ОГРАБЛЕН! 🐫💰\nДобыча: +${gainedGold} золота!`);
  updateHUD();

  // Охрана корована нападает на игрока
  setTimeout(() => {
    takeDamage(20, 'arm'); // Охрана наносит урон и может ранить руку!
  }, 400);
}

// Нанесение урона NPC и превращение в честный 3D-труп
function damageNpc(npc, amount) {
  npc.hp -= amount;
  playSound('hit');

  if (npc.hp <= 0 && npc.alive) {
    npc.alive = false;
    scene.remove(npc.mesh);

    // "И враги 3-хмерные тоже, и труп тоже 3д" -> Спавним 3D-труп
    create3DCorpse(npc.mesh.position.clone(), npc.faction);

    if (npc.faction === 'guards') GameState.guardsKilled++;
    showBanner(`Враг сражен! Обыщите 3D-труп!`);
    GameState.player.gold += 30;
    updateHUD();
  }
}

// Честный 3D-труп на земле
function create3DCorpse(pos, faction) {
  const corpse = createHumanoidMesh(0x555555, 0x333333);
  corpse.position.copy(pos);
  corpse.position.y = 0.4;
  corpse.rotation.x = Math.PI / 2; // Лежит на земле
  corpse.rotation.z = Math.random() * Math.PI;
  scene.add(corpse);
  corpses.push(corpse);
}

// --- СИСТЕМА УВЕЧИЙ, РАСЧЛЕНЁНКИ И ТРАВМ ИГРОКА ---
// "Так же чтобы в игре могли не только убить но и отрубить руку...
// так же выколоть глаз но пользователь может не умереть а просто пол экрана не видеть...
// если ногу тоже либо умреш либо будеш ползать либо на коляске котаться"
function takeDamage(amount, targetLimb = null) {
  playSound('hurt');
  GameState.player.hp = Math.max(0, GameState.player.hp - amount);

  // Случайное или целевое увечье
  const roll = Math.random();
  if (targetLimb === 'arm' || (roll < 0.25 && GameState.player.limbs.arm === 'ok')) {
    GameState.player.limbs.arm = 'damaged';
    GameState.player.bleeding = true;
    showBanner("ВАМ ОТРУБИЛИ РУКУ!\nСрочно найдите лекаря, иначе истечете кровью!");
  } else if (targetLimb === 'eye' || (roll >= 0.25 && roll < 0.5 && GameState.player.limbs.eye === 'ok')) {
    GameState.player.limbs.eye = 'damaged';
    showBanner("ВАМ ВЫКОЛОЛИ ГЛАЗ!\nПоловина экрана ослепла!");
  } else if (targetLimb === 'leg' || (roll >= 0.5 && roll < 0.75 && GameState.player.limbs.leg === 'ok')) {
    GameState.player.limbs.leg = 'damaged';
    GameState.player.crawling = true;
    showBanner("ВАМ ПЕРЕБИЛИ НОГУ!\nВы можете только ползать! Купите протез или коляску!");
  }

  updateHUD();

  if (GameState.player.hp <= 0) {
    showBanner("ВЫ ПОГИБЛИ!\nНажмите F9 для быстрой загрузки!");
  }
}

// Взаимодействие [E]: Торговля, Приказы командира
function handleInteraction() {
  const pPos = yawObject.position;

  // 1. Проверка близости торговца
  for (let shop of shops) {
    if (pPos.distanceTo(shop.position) < shop.radius) {
      openShop();
      return;
    }
  }

  // 2. Проверка командира дворца
  const palaceCenter = new THREE.Vector3(101, 0, 0);
  if (pPos.distanceTo(palaceCenter) < 10 && GameState.player.faction === 'guards') {
    talkToCommander();
    return;
  }
}

// Диалог с командиром охраны дворца
function talkToCommander() {
  const orders = [
    "«Солдат! Разведка донесла, что эльфы снова планируют набег на тракт! Защищай ворота!»",
    "«Внимание, караул! Шпионы злодея пробрались в предгорья. Будь начеку!»",
    "«Приказ: выступить рейдом на горный форт Злодея и подавить бунт!»"
  ];
  const randOrder = orders[Math.floor(Math.random() * orders.length)];
  document.getElementById('commander-order-text').innerText = randOrder;
  showBanner("Командир отдал приказ!");
}

// Приказы Злодея своим войскам
function setVillainArmyOrder(order) {
  if (GameState.player.faction !== 'villain') return;
  GameState.villainArmyState = order;

  if (order === 'follow') {
    showBanner("Злодей: «Орда, за мной!»");
  } else if (order === 'attack_palace') {
    showBanner("Злодей: «В АТАКУ НА ДВОРЕЦ ИМПЕРАТОРА!» ⚔️🔥");
  } else if (order === 'raid_elves') {
    showBanner("Злодей: «Набег на эльфийские домики!» 🌲🏹");
  }
}

// --- ЛАВКА DAGGERFALL: ТОРГОВЛЯ ПРОТЕЗАМИ И ЛЕЧЕНИЕ ---
const SHOP_ITEMS = [
  { id: 'eye_patch', name: 'Золотой монокль / Глазная повязка', cost: 100, desc: 'Восстанавливает зрение (убирает слепоту глаза)', type: 'eye' },
  { id: 'arm_prosthetic', name: 'Железный механический протез руки', cost: 150, desc: 'Останавливает кровотечение и возвращает силу удара', type: 'arm' },
  { id: 'leg_prosthetic', name: 'Деревянный протез ноги (Daggerfall)', cost: 180, desc: 'Возвращает способность быстро бегать и прыгать', type: 'leg' },
  { id: 'wheelchair', name: 'Инвалидная коляска с шипами', cost: 120, desc: 'Позволяет быстро передвигаться даже без обеих ног', type: 'wheelchair' },
  { id: 'bandage', name: 'Лечебный бальзам и перевязка', cost: 40, desc: 'Восстанавливает 50 HP и лечит кровотечение', type: 'heal' }
];

function setupShopData() {
  const list = document.getElementById('shop-items-list');
  list.innerHTML = '';

  SHOP_ITEMS.forEach(item => {
    const card = document.createElement('div');
    card.className = 'shop-item-card';
    card.innerHTML = `
      <div class="shop-item-info">
        <h4>${item.name}</h4>
        <p>${item.desc}</p>
      </div>
      <button class="buy-btn" data-id="${item.id}">Купить (${item.cost} 💰)</button>
    `;
    list.appendChild(card);
  });

  list.addEventListener('click', (e) => {
    if (e.target.classList.contains('buy-btn')) {
      const itemId = e.target.getAttribute('data-id');
      buyItem(itemId);
    }
  });

  document.getElementById('btn-close-shop').addEventListener('click', closeShop);
}

function openShop() {
  document.exitPointerLock();
  document.getElementById('shop-modal').classList.remove('hidden');
}

function closeShop() {
  document.getElementById('shop-modal').classList.add('hidden');
  document.body.requestPointerLock();
}

function buyItem(id) {
  const item = SHOP_ITEMS.find(i => i.id === id);
  if (!item) return;

  if (GameState.player.gold < item.cost) {
    alert("Недостаточно золота!");
    return;
  }

  GameState.player.gold -= item.cost;
  playSound('buy');

  if (item.type === 'eye') {
    GameState.player.limbs.eye = 'prosthetic';
  } else if (item.type === 'arm') {
    GameState.player.limbs.arm = 'prosthetic';
    GameState.player.bleeding = false;
  } else if (item.type === 'leg') {
    GameState.player.limbs.leg = 'prosthetic';
    GameState.player.crawling = false;
  } else if (item.type === 'wheelchair') {
    GameState.player.hasWheelchair = true;
    GameState.player.crawling = false;
  } else if (item.type === 'heal') {
    GameState.player.hp = Math.min(GameState.player.maxHp, GameState.player.hp + 50);
    GameState.player.bleeding = false;
  }

  updateHUD();
  showBanner(`Куплено: ${item.name}!`);
}

// --- БЫСТРЫЕ СОХРАНЕНИЯ (F5 / F9) ---
function saveGame() {
  const saveData = {
    player: {
      hp: GameState.player.hp,
      gold: GameState.player.gold,
      faction: GameState.player.faction,
      limbs: GameState.player.limbs,
      bleeding: GameState.player.bleeding,
      hasWheelchair: GameState.player.hasWheelchair,
      position: { x: yawObject.position.x, y: yawObject.position.y, z: yawObject.position.z }
    },
    korovansRobbed: GameState.korovansRobbed,
    guardsKilled: GameState.guardsKilled,
    timestamp: new Date().toLocaleTimeString()
  };
  localStorage.setItem('korovany_3d_save', JSON.stringify(saveData));
  showBanner("ИГРА БЫСТРО СОХРАНЕНА! (F5)");
}

function loadGame() {
  const raw = localStorage.getItem('korovany_3d_save');
  if (!raw) {
    showBanner("Нет сохраненной игры!");
    return;
  }
  const data = JSON.parse(raw);
  GameState.player.hp = data.player.hp;
  GameState.player.gold = data.player.gold;
  GameState.player.faction = data.player.faction;
  GameState.player.limbs = data.player.limbs;
  GameState.player.bleeding = data.player.bleeding;
  GameState.player.hasWheelchair = data.player.hasWheelchair;
  GameState.korovansRobbed = data.korovansRobbed;
  GameState.guardsKilled = data.guardsKilled;

  yawObject.position.set(data.player.position.x, data.player.position.y, data.player.position.z);

  setFaction(GameState.player.faction);
  updateHUD();
  showBanner(`ИГРА ЗАГРУЖЕНА! (F9) [${data.timestamp}]`);
}

// --- ОБНОВЛЕНИЕ ИНТЕРФЕЙСА (HUD) ---
function updateHUD() {
  document.getElementById('hp-bar').style.width = `${(GameState.player.hp / GameState.player.maxHp) * 100}%`;
  document.getElementById('hp-text').innerText = `${Math.ceil(GameState.player.hp)}/${GameState.player.maxHp}`;
  document.getElementById('gold-val').innerText = GameState.player.gold;

  // Состояние глаза
  const eyeEl = document.getElementById('part-eye');
  const overlayEl = document.getElementById('eye-blindness-overlay');
  if (GameState.player.limbs.eye === 'damaged') {
    eyeEl.className = 'body-part damaged';
    eyeEl.innerText = 'Глаз: Выколот! (Слепота)';
    overlayEl.classList.remove('hidden');
  } else if (GameState.player.limbs.eye === 'prosthetic') {
    eyeEl.className = 'body-part prosthetic';
    eyeEl.innerText = 'Глаз: Золотой монокль';
    overlayEl.classList.add('hidden');
  } else {
    eyeEl.className = 'body-part ok';
    eyeEl.innerText = 'Глаза: Оба видят';
    overlayEl.classList.add('hidden');
  }

  // Рука
  const armEl = document.getElementById('part-arm');
  if (GameState.player.limbs.arm === 'damaged') {
    armEl.className = 'body-part damaged';
    armEl.innerText = 'Рука: Отрублена!';
  } else if (GameState.player.limbs.arm === 'prosthetic') {
    armEl.className = 'body-part prosthetic';
    armEl.innerText = 'Рука: Стальной протез';
  } else {
    armEl.className = 'body-part ok';
    armEl.innerText = 'Рука: Цела';
  }

  // Нога
  const legEl = document.getElementById('part-leg');
  if (GameState.player.limbs.leg === 'damaged') {
    if (GameState.player.hasWheelchair) {
      legEl.className = 'body-part prosthetic';
      legEl.innerText = 'Нога: Инвалидная коляска';
    } else {
      legEl.className = 'body-part damaged';
      legEl.innerText = 'Нога: Отрублена! (Ползание)';
    }
  } else if (GameState.player.limbs.leg === 'prosthetic') {
    legEl.className = 'body-part prosthetic';
    legEl.innerText = 'Нога: Протез (Daggerfall)';
  } else {
    legEl.className = 'body-part ok';
    legEl.innerText = 'Нога: Цела (Бег)';
  }

  // Кровотечение
  const bleedEl = document.getElementById('bleeding-alert');
  if (GameState.player.bleeding) {
    bleedEl.classList.remove('hidden');
  } else {
    bleedEl.classList.add('hidden');
  }

  // Текущая зона
  const currentZone = getCurrentZoneName(yawObject.position);
  document.getElementById('zone-name').innerText = currentZone;
}

function getCurrentZoneName(pos) {
  if (pos.z > 50) return ZONES.VILLAIN.name;
  if (pos.x < -50) return ZONES.ELVES.name;
  if (pos.x > 50) return ZONES.PALACE.name;
  return ZONES.NEUTRAL.name;
}

function showBanner(text) {
  const b = document.getElementById('banner-notification');
  b.innerText = text;
  b.classList.remove('hidden');
  setTimeout(() => { b.classList.add('hidden'); }, 3500);
}

// Настройка выбора фракций
function setupUI() {
  const cards = document.querySelectorAll('.faction-card');
  cards.forEach(card => {
    card.addEventListener('click', () => {
      const faction = card.getAttribute('data-faction');
      setFaction(faction);
      document.getElementById('faction-modal').classList.add('hidden');
    });
  });

  // Кнопки приказов злодея
  document.getElementById('btn-army-follow').addEventListener('click', () => setVillainArmyOrder('follow'));
  document.getElementById('btn-army-attack-palace').addEventListener('click', () => setVillainArmyOrder('attack_palace'));
  document.getElementById('btn-army-raid-elves').addEventListener('click', () => setVillainArmyOrder('raid_elves'));
}

function setFaction(faction) {
  GameState.player.faction = faction;
  const fName = document.getElementById('faction-name');
  const vControls = document.getElementById('villain-controls');
  const orderTitle = document.getElementById('commander-order-title');
  const orderText = document.getElementById('commander-order-text');

  if (faction === 'elves') {
    fName.innerText = 'Лесные Эльфы 🧝‍♂️';
    yawObject.position.set(-110, 2, 0); // Спавн в эльфийском лесу
    orderTitle.innerText = 'Цель Эльфов:';
    orderText.innerText = 'Защищайте деревянные домики от набегов и ГРАБЬТЕ КОРОВАНЫ на главном тракте!';
    vControls.classList.add('hidden');
  } else if (faction === 'guards') {
    fName.innerText = 'Охрана Дворца 🛡️';
    yawObject.position.set(100, 2, 0); // Спавн у дворца
    orderTitle.innerText = 'Приказ Командира:';
    orderText.innerText = 'Слушайтесь командира дворца, отбивайте набеги шпионов и эльфов-партизан!';
    vControls.classList.add('hidden');
  } else if (faction === 'villain') {
    fName.innerText = 'Злодей (Лорд Тьмы) 👑';
    yawObject.position.set(0, 18, 110); // Спавн в форте в горах
    orderTitle.innerText = 'Воля Злодея:';
    orderText.innerText = 'Вы сам себе командир! Отдавайте приказы войскам кнопками [1], [2], [3] и идите в атаку на дворец!';
    vControls.classList.remove('hidden');
  }
  updateHUD();
}

// --- ИГРОВОЙ ЦИКЛ (ANIMATE / TICK) ---
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  updatePlayer(delta);
  updateLODTrees();
  updateKorovans(delta);
  updateNpcs(delta);

  renderer.render(scene, camera);
}

function getTerrainHeight(x, z) {
  if (z > 40) {
    const dist = z - 40;
    return Math.sin(x * 0.05) * 6 + Math.cos(z * 0.05) * 8 + (dist * 0.4);
  }
  return Math.sin(x * 0.04) * 0.8 + Math.cos(z * 0.04) * 0.8;
}

// Движение игрока и физика
function updatePlayer(delta) {
  const groundY = getTerrainHeight(yawObject.position.x, yawObject.position.z);
  const eyeHeight = GameState.player.limbs.leg === 'damaged' 
    ? (GameState.player.hasWheelchair ? 1.3 : 0.7) 
    : 2.0;

  // Скорость перемещения
  if (GameState.player.limbs.leg === 'damaged') {
    GameState.player.speed = GameState.player.hasWheelchair ? 0.22 : 0.07;
  } else {
    GameState.player.speed = 0.25;
  }

  // Физика гравитации и высоты пола
  const targetFloorY = groundY + eyeHeight;
  if (yawObject.position.y > targetFloorY + 0.01) {
    velocity.y -= 0.015;
    yawObject.position.y += velocity.y;
    if (yawObject.position.y < targetFloorY) {
      yawObject.position.y = targetFloorY;
      velocity.y = 0;
      canJump = true;
    }
  } else {
    yawObject.position.y = targetFloorY;
    velocity.y = 0;
    canJump = true;
  }

  // Кровотечение
  if (GameState.player.bleeding) {
    GameState.player.hp -= delta * 1.5;
    if (GameState.player.hp <= 0) {
      GameState.player.hp = 0;
      showBanner("ВЫ СКОНЧАЛИСЬ ОТ ПОТЕРИ КРОВИ! Нажмите F9!");
    }
    updateHUD();
  }

  if (isLocked) {
    direction.z = Number(moveState.forward) - Number(moveState.backward);
    direction.x = Number(moveState.right) - Number(moveState.left);
    direction.normalize();

    if (moveState.forward || moveState.backward) {
      yawObject.translateZ(-direction.z * GameState.player.speed);
    }
    if (moveState.left || moveState.right) {
      yawObject.translateX(direction.x * GameState.player.speed);
    }

    // Подсказка действия [E]
    const currentDistToShop = yawObject.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const prompt = document.getElementById('action-prompt');
    if (currentDistToShop < 6) {
      prompt.innerText = '[E] Торговля (Лавка Лекаря-Протезиста)';
      prompt.classList.remove('hidden');
    } else if (yawObject.position.distanceTo(new THREE.Vector3(101, 0, 0)) < 8 && GameState.player.faction === 'guards') {
      prompt.innerText = '[E] Поговорить с командиром охраны';
      prompt.classList.remove('hidden');
    } else {
      prompt.classList.add('hidden');
    }
  }
}

// ОБНОВЛЕНИЕ ДЕРЕВЬЕВ: "Вдали картинкой, вблизи 3-хмерные"
function updateLODTrees() {
  const pPos = yawObject.position;
  const LOD_DISTANCE = 45; // Дистанция переключения

  for (let tree of treeEntities) {
    const dist = pPos.distanceTo(tree.pos);

    if (dist < LOD_DISTANCE) {
      // Вблизи: включаем честный 3D меш
      if (!tree.is3D) {
        tree.mesh3D.visible = true;
        tree.sprite2D.visible = false;
        tree.is3D = true;
      }
    } else {
      // Вдали: включаем 2D спрайт-картинку
      if (tree.is3D) {
        tree.mesh3D.visible = false;
        tree.sprite2D.visible = true;
        tree.is3D = false;
      }
    }
  }
}

// Движение корованов по тракту
function updateKorovans(delta) {
  for (let k of korovans) {
    k.position.x += k.userData.direction * k.userData.speed;

    // Циклическое движение туда и обратно
    if (k.position.x > 180) {
      k.userData.direction = -1;
      k.rotation.y = Math.PI;
      k.userData.robbable = true; // восстанавливает груз на новом круге
    } else if (k.position.x < -180) {
      k.userData.direction = 1;
      k.rotation.y = 0;
      k.userData.robbable = true;
    }
  }
}

// Искусственный интеллект войск и набегов
function updateNpcs(delta) {
  for (let npc of npcs) {
    if (!npc.alive) continue;

    // Поведение войск Злодея
    if (npc.faction === 'villain') {
      if (GameState.villainArmyState === 'follow' && GameState.player.faction === 'villain') {
        // Идут за игроком
        npc.mesh.lookAt(yawObject.position.x, npc.mesh.position.y, yawObject.position.z);
        if (npc.mesh.position.distanceTo(yawObject.position) > 5) {
          npc.mesh.translateZ(npc.speed);
        }
      } else if (GameState.villainArmyState === 'attack_palace') {
        // Набег на дворец императора (120, 0, 0)
        npc.mesh.lookAt(120, npc.mesh.position.y, 0);
        npc.mesh.translateZ(npc.speed * 1.3);
      } else if (GameState.villainArmyState === 'raid_elves') {
        // Набег на эльфов (-120, 0, 0)
        npc.mesh.lookAt(-120, npc.mesh.position.y, 0);
        npc.mesh.translateZ(npc.speed * 1.3);
      }
    }

    // Солдаты охраны дворца защищают периметр или идут в контратаку
    if (npc.faction === 'guards') {
      // Патрулирование
      npc.mesh.rotation.y += 0.01;
    }
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Запуск игры при загрузке окна
window.addEventListener('load', init);
