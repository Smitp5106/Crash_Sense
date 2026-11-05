const $ = (id) => document.getElementById(id);
let requestInFlight = false;
let locationAuthorized = false;
let locationRequestInFlight = false;
let locationAuthConfigured = false;

function setBadge(element, text, className) {
  element.textContent = text;
  element.className = `connection-label ${className}`;
  const dot = document.querySelector('.live-dot');
  dot.className = `live-dot ${className}`;
}

function showOffline(message) {
  setBadge($('connectionBadge'), 'No live connection', 'badge-offline');
  $('offlineMessage').classList.remove('hidden');
  $('offlineMessage').title = message || '';
}

function showOnline() {
  setBadge($('connectionBadge'), 'R4 connected', 'badge-online');
  $('offlineMessage').classList.add('hidden');
}

function formatNumber(value, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '--';
}

function clearPrivateLocation() {
  $('speed').textContent = '--';
  $('latitude').textContent = '--';
  $('longitude').textContent = '--';
  $('satellites').textContent = '--';
  $('fixAge').textContent = '--';
  $('mapLink').href = '#';
  $('mapLink').classList.add('disabled');
  $('mapLink').setAttribute('aria-disabled', 'true');
}

function setLocationAccess(enabled) {
  locationAuthorized = enabled;
  $('locationLocked').classList.toggle('hidden', enabled);
  $('locationPrivate').classList.toggle('hidden', !enabled);
  if (!enabled) clearPrivateLocation();
}

function openLocationLogin(message = '') {
  $('authError').textContent = message;
  $('authConfigNote').classList.toggle('hidden', locationAuthConfigured);
  if (!locationAuthConfigured) $('authConfigNote').textContent = 'Location sign-in is not configured on the server yet.';
  const dialog = $('locationDialog');
  if (!dialog.open) dialog.showModal();
  if (locationAuthConfigured) $('authUsername').focus();
}

async function checkAuthStatus() {
  try {
    const response = await fetch('/api/auth/status', { cache: 'no-store', credentials: 'same-origin' });
    const status = await response.json();
    locationAuthConfigured = Boolean(status.configured);
    if (status.authenticated) {
      setLocationAccess(true);
      await refreshPrivateLocation();
    }
  } catch {
    locationAuthConfigured = false;
  }
}

async function refreshPrivateLocation() {
  if (!locationAuthorized || locationRequestInFlight) return;
  locationRequestInFlight = true;
  try {
    const response = await fetch('/api/device/location', { cache: 'no-store', credentials: 'same-origin' });
    if (response.status === 401) {
      setLocationAccess(false);
      return;
    }
    if (!response.ok) throw new Error('Private location is currently unavailable.');
    const data = await response.json();
    const gps = data.gps || {};
    $('speed').textContent = formatNumber(gps.speedKmh, 1);
    $('latitude').textContent = gps.latitude == null ? 'Waiting for fix' : formatNumber(gps.latitude, 6);
    $('longitude').textContent = gps.longitude == null ? 'Waiting for fix' : formatNumber(gps.longitude, 6);
    $('satellites').textContent = gps.satellites ?? '--';
    $('fixAge').textContent = gps.hasFix ? `${gps.fixAgeSec}s ago` : (gps.latitude != null ? 'Last known' : 'No fix');
    if (gps.mapUrl && String(gps.mapUrl).startsWith('https://')) {
      $('mapLink').href = gps.mapUrl;
      $('mapLink').classList.remove('disabled');
      $('mapLink').setAttribute('aria-disabled', 'false');
    } else {
      $('mapLink').href = '#';
      $('mapLink').classList.add('disabled');
      $('mapLink').setAttribute('aria-disabled', 'true');
    }
  } catch (error) {
    clearPrivateLocation();
    $('latitude').textContent = 'Unavailable';
    $('longitude').textContent = 'Unavailable';
    $('authError').textContent = error.message;
  } finally {
    locationRequestInFlight = false;
  }
}

function updateDashboard(data) {
  const motion = data.motion || {};
  const gps = data.gps || {};
  const system = data.system || {};
  const detection = data.detection || {};
  const incident = data.incident || {};
  showOnline();

  const state = system.state || 'UNKNOWN';
  $('stateBadge').textContent = state.replaceAll('_', ' ');
  $('stateBadge').className = `state-pill ${state === 'IDLE' ? 'state-idle' : (state === 'COUNTDOWN' || state === 'EMERGENCY_ALERT' ? 'state-alert' : '')}`;
  $('sensorBadge').textContent = motion.sensorReady === false ? 'Sensor unavailable' : 'Sensor active';
  $('sensorBadge').className = `small-status ${motion.sensorReady === false ? 'sensor-error' : 'sensor-ok'}`;
  $('totalG').innerHTML = `${formatNumber(motion.totalG, 2)}<small> g</small>`;
  $('gyro').innerHTML = `${formatNumber(motion.gyroMag, 1)} <small>°/s</small>`;
  $('jerk').innerHTML = `${formatNumber(motion.jerk, 1)} <small>g/s</small>`;
  $('ax').textContent = formatNumber(motion.ax, 2);
  $('ay').textContent = formatNumber(motion.ay, 2);
  $('az').textContent = formatNumber(motion.az, 2);
  $('roll').textContent = `${formatNumber(motion.roll, 1)}°`;
  $('pitch').textContent = `${formatNumber(motion.pitch, 1)}°`;
  $('classification').textContent = detection.classification || 'Unknown';
  $('classificationReason').textContent = detection.reason || 'No detection details from the board.';
  $('classificationPanel').classList.toggle('alert', state === 'COUNTDOWN' || state === 'EMERGENCY_ALERT');

  const hasFix = Boolean(gps.hasFix);
  $('gpsBadge').textContent = hasFix ? 'GPS active · protected' : 'No GPS fix';
  $('gpsBadge').className = `small-status ${hasFix ? 'sensor-ok' : 'sensor-error'}`;

  const countdown = state === 'COUNTDOWN';
  const emergency = state === 'EMERGENCY_ALERT';
  $('alertBanner').classList.toggle('hidden', !countdown && !emergency);
  if (countdown || emergency) {
    $('alertTitle').textContent = countdown ? 'Crash suspected' : 'Emergency alert active';
    $('alertReason').textContent = detection.reason || 'Check the vehicle.';
    $('countdownBlock').classList.toggle('hidden', !countdown);
    $('countdownValue').textContent = formatNumber(system.countdownSec, 0);
    $('cancelButton').classList.toggle('hidden', !countdown);
  }

  const hasIncident = Boolean(incident.id);
  $('incidentBadge').textContent = hasIncident ? (incident.status || 'Recorded') : 'No incident';
  $('incidentBadge').className = `small-status ${incident.status === 'EMERGENCY_ALERT' ? 'sensor-error' : ''}`;
  $('incidentEmpty').classList.toggle('hidden', hasIncident);
  $('incidentDetails').classList.toggle('hidden', !hasIncident);
  if (hasIncident) {
    $('incidentId').textContent = incident.id;
    $('incidentPeak').textContent = `${formatNumber(incident.peakG, 2)} g`;
    $('incidentGyro').textContent = `${formatNumber(incident.peakGyro, 1)} °/s`;
    $('incidentStatus').textContent = incident.status || '--';
    $('incidentReason').textContent = incident.reason || '';
  }
}

async function refreshFromBoard() {
  if (requestInFlight) return;
  requestInFlight = true;
  try {
    const response = await fetch('/api/device/data', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Device request failed (${response.status})`);
    updateDashboard(await response.json());
    if (locationAuthorized) await refreshPrivateLocation();
  } catch (error) {
    showOffline(error.message);
  } finally {
    requestInFlight = false;
  }
}

async function cancelCountdown() {
  if (!locationAuthorized) {
    openLocationLogin('Sign in before sending a vehicle command.');
    return;
  }
  const button = $('cancelButton');
  button.disabled = true;
  try {
    const response = await fetch('/api/device/cancel', { method: 'POST' });
    if (!response.ok) throw new Error('Cancel request failed');
    await refreshFromBoard();
  } catch (error) {
    showOffline(error.message);
  } finally {
    button.disabled = false;
  }
}

$('cancelButton').addEventListener('click', cancelCountdown);
 $('unlockLocation').addEventListener('click', () => openLocationLogin());
 $('lockLocation').addEventListener('click', async () => {
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
  setLocationAccess(false);
 });
 $('closeAuth').addEventListener('click', () => $('locationDialog').close());
 $('locationDialog').addEventListener('click', event => {
  if (event.target === $('locationDialog')) $('locationDialog').close();
 });
 $('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('authSubmit');
  button.disabled = true;
  $('authError').textContent = '';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('authUsername').value, password: $('authPassword').value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Sign-in failed');
    locationAuthConfigured = true;
    $('authPassword').value = '';
    $('locationDialog').close();
    setLocationAccess(true);
    await refreshPrivateLocation();
  } catch (error) {
    $('authError').textContent = error.message;
  } finally {
    button.disabled = false;
  }
 });
checkAuthStatus();
refreshFromBoard();
setInterval(refreshFromBoard, 1000);

// Independent 3D showroom interaction. It never reads or changes device telemetry.
(function initCarPlayground() {
  const mount = $('carCanvas');
  if (!mount || !window.THREE) {
    mount.textContent = 'Interactive 3D view is unavailable in this browser.';
    return;
  }

  const THREE = window.THREE;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8ede5');
  scene.fog = new THREE.Fog('#e8ede5', 70, 220);
  const camera = new THREE.PerspectiveCamera(34, 1, .1, 100);
  camera.position.set(5.7, 4.2, 7.2);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D model of a car on a display platform');
  renderer.domElement.tabIndex = 0;
  mount.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight('#f7fff8', '#708274', 2.0));
  const keyLight = new THREE.DirectionalLight('#fff7e7', 3.2);
  keyLight.position.set(-4, 8, 5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight('#b7e4cb', 1.8);
  rimLight.position.set(4, 5, -6);
  scene.add(rimLight);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#e8ede5', roughness: .92 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -.12;
  floor.receiveShadow = true;
  scene.add(floor);

  const platform = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, .16, 128), new THREE.MeshStandardMaterial({ color: '#f5f6f0', roughness: .76, metalness: .02 }));
  platform.position.y = -.04;
  platform.receiveShadow = true;
  scene.add(platform);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(39.8, .018, 8, 160), new THREE.MeshStandardMaterial({ color: '#9db9a3', roughness: .5 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = .045;
  scene.add(rim);
  const grid = new THREE.GridHelper(100, 100, '#b8cbbb', '#d5ded4');
  grid.position.y = .055;
  grid.material.transparent = true;
  grid.material.opacity = .34;
  scene.add(grid);

  const car = new THREE.Group();
  const carPaint = new THREE.MeshStandardMaterial({ color: '#145c49', metalness: .32, roughness: .27 });
  const darkPaint = new THREE.MeshStandardMaterial({ color: '#103d34', metalness: .22, roughness: .32 });
  const glass = new THREE.MeshStandardMaterial({ color: '#91b4a9', metalness: .36, roughness: .2, transparent: true, opacity: .88 });
  const trim = new THREE.MeshStandardMaterial({ color: '#18312c', metalness: .5, roughness: .42 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#c8d4cc', metalness: .82, roughness: .22 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#202b28', roughness: .82 });
  const lamp = new THREE.MeshStandardMaterial({ color: '#fff0c2', emissive: '#ffdf91', emissiveIntensity: 1.2, roughness: .24 });

  function sideShape(points, depth, material, yOffset = 0) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: .035, bevelThickness: .025 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(-depth / 2, yOffset, 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    car.add(mesh);
    return mesh;
  }

  sideShape([[-1.55,.34],[-1.48,.67],[-1.18,.79],[-.8,1.13],[-.42,1.2],[.43,1.18],[.78,.78],[1.32,.71],[1.52,.52],[1.48,.34]],1.42,carPaint);
  sideShape([[-.78,.82],[-.42,1.12],[-.28,1.14],[.34,1.12],[.63,.82]],1.445,glass);
  // Front and rear fascia, bumper, grille, and lights.
  const box = (w,h,d,mat,x,y,z,parent=car) => { const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m; };
  box(.92,.16,.08,darkPaint,0,.4,-1.54);
  box(.66,.13,.055,trim,0,.46,-1.595);
  box(.95,.14,.1,darkPaint,0,.39,1.5);
  for (const x of [-.49,.49]) {
    box(.27,.105,.045,lamp,x,.61,-1.47);
    box(.22,.09,.045,new THREE.MeshStandardMaterial({color:'#a8453b',emissive:'#66221b',roughness:.25}),x,.58,1.48);
    const mirror=box(.13,.09,.2,carPaint,x*1.42,.78,-.37);
    mirror.rotation.y=x<0?-.15:.15;
  }
  // Four wheels with bright hubs; save wheel groups so they can spin while moving.
  const wheels=[];
  for (const x of [-.73,.73]) for (const z of [-.94,.94]) {
    const wheel=new THREE.Group(); wheel.position.set(x,.34,z); car.add(wheel); wheels.push(wheel);
    const tire=new THREE.Mesh(new THREE.CylinderGeometry(.34,.34,.19,28),rubber);
    tire.rotation.z=Math.PI/2; tire.castShadow=true; wheel.add(tire);
    const hub=new THREE.Mesh(new THREE.CylinderGeometry(.19,.19,.205,24),chrome);
    hub.rotation.z=Math.PI/2; wheel.add(hub);
    const center=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.215,20),darkPaint);
    center.rotation.z=Math.PI/2; wheel.add(center);
  }
  const shadow=new THREE.Mesh(new THREE.CircleGeometry(1.7,48),new THREE.MeshBasicMaterial({color:'#29493b',transparent:true,opacity:.13,depthWrite:false}));
  shadow.rotation.x=-Math.PI/2; shadow.scale.set(1,1.48,1); shadow.position.y=.045; car.add(shadow);
  car.position.y=.02;
  scene.add(car);

  let cameraYaw = .68;
  let cameraPitch = .38;
  let cameraDistance = 13;
  let cameraSideOffset = 2.8;
  const target = new THREE.Vector3(-Math.cos(cameraYaw)*cameraSideOffset,.55,Math.sin(cameraYaw)*cameraSideOffset);
  let dragging = false;
  let lastPointer = {x:0,y:0};
  const held = new Set();
  let lastFrame = performance.now();
  let resizeObserver;
  function resize() {
    const w = Math.max(1,mount.clientWidth), h = Math.max(1,mount.clientHeight);
    renderer.setSize(w,h,false);
    camera.aspect=w/h;
    cameraSideOffset=Math.min(3.4,Math.max(.8,cameraDistance*Math.tan(camera.fov*Math.PI/360)*camera.aspect*.62));
    camera.updateProjectionMatrix();
  }
  function updateCamera() {
    const horizontal=Math.cos(cameraPitch)*cameraDistance;
    camera.position.set(target.x+Math.sin(cameraYaw)*horizontal,target.y+Math.sin(cameraPitch)*cameraDistance,target.z+Math.cos(cameraYaw)*horizontal);
    camera.lookAt(target);
  }
  function resetCar() { car.position.set(0,.02,0);car.rotation.y=0;cameraYaw=.68;cameraPitch=.38;cameraDistance=13;cameraSideOffset=Math.min(3.4,Math.max(.8,cameraDistance*Math.tan(camera.fov*Math.PI/360)*camera.aspect*.62));target.set(-Math.cos(cameraYaw)*cameraSideOffset,.55,Math.sin(cameraYaw)*cameraSideOffset);updateCamera(); }
  function driveKey(event, down) {
    const key=event.key.toLowerCase();
    const map={w:'forward',arrowup:'forward',s:'reverse',arrowdown:'reverse',a:'left',arrowleft:'left',d:'right',arrowright:'right'};
    if (!map[key]) return;
    if ($('locationDialog').open) {
      if (!down) held.delete(map[key]);
      return;
    }
    const focused = document.activeElement;
    const typing = focused && (focused.matches('input,textarea,select,[contenteditable="true"]'));
    const stage = $('carStage');
    const focusedCar = focused === stage || stage.contains(focused);
    const neutralFocus = focused === document.body || focused === document.documentElement;
    if (typing || (!focusedCar && !neutralFocus)) {
      if (!down) held.delete(map[key]);
      return;
    }
    event.preventDefault();
    if(down) held.add(map[key]); else held.delete(map[key]);
  }
  window.addEventListener('keydown',e=>driveKey(e,true));
  window.addEventListener('keyup',e=>driveKey(e,false));
  window.addEventListener('blur',()=>held.clear());
  mount.addEventListener('pointerdown',e=>{if(e.target!==renderer.domElement)return;renderer.domElement.focus({preventScroll:true});dragging=true;lastPointer={x:e.clientX,y:e.clientY};mount.setPointerCapture(e.pointerId);});
  mount.addEventListener('pointermove',e=>{if(!dragging)return;const dx=e.clientX-lastPointer.x,dy=e.clientY-lastPointer.y;lastPointer={x:e.clientX,y:e.clientY};cameraYaw-=dx*.006;cameraPitch=THREE.MathUtils.clamp(cameraPitch+dy*.004,-.05,.9);updateCamera();});
  mount.addEventListener('pointerup',()=>{dragging=false;});
  mount.addEventListener('pointercancel',()=>{dragging=false;});
  mount.addEventListener('wheel',e=>{cameraDistance=THREE.MathUtils.clamp(cameraDistance+e.deltaY*.005,6.5,13);updateCamera();},{passive:true});
  document.querySelectorAll('[data-drive]').forEach(button=>{
    const direction=button.dataset.drive;
    const down=e=>{e.preventDefault();renderer.domElement.focus({preventScroll:true});held.add(direction);button.setPointerCapture?.(e.pointerId);};
    const up=e=>{e.preventDefault();held.delete(direction);};
    button.addEventListener('pointerdown',down);button.addEventListener('pointerup',up);button.addEventListener('pointercancel',up);button.addEventListener('lostpointercapture',up);button.addEventListener('contextmenu',e=>e.preventDefault());
  });
  $('resetCar').addEventListener('click',()=>{resetCar();renderer.domElement.focus({preventScroll:true});});
  $('locationDialog').addEventListener('close',()=>renderer.domElement.focus({preventScroll:true}));
  resizeObserver=new ResizeObserver(resize);resizeObserver.observe(mount);resize();updateCamera();

  function animate(now) {
    requestAnimationFrame(animate);
    const dt=Math.min((now-lastFrame)/1000,.04);lastFrame=now;
    cameraSideOffset=Math.min(3.4,Math.max(.8,cameraDistance*Math.tan(camera.fov*Math.PI/360)*camera.aspect*.62));
    const steering=(held.has('left')?1:0)+(held.has('right')?-1:0);
    const throttle=(held.has('forward')?1:0)-(held.has('reverse')?1:0);
    if(throttle){
      car.rotation.y+=steering*dt*1.65*Math.sign(throttle);
      const speed=2.5*throttle*dt;
      const nextX=car.position.x-Math.sin(car.rotation.y)*speed;
      const nextZ=car.position.z-Math.cos(car.rotation.y)*speed;
      if(Math.hypot(nextX,nextZ)<32){car.position.x=nextX;car.position.z=nextZ;for(const wheel of wheels)wheel.rotation.x-=speed*2.6;}
    } else if(steering){car.rotation.y+=steering*dt*.85;}
    const follow=Math.min(1,dt*3.5);
    const followTargetX=car.position.x-Math.cos(cameraYaw)*cameraSideOffset;
    const followTargetZ=car.position.z+Math.sin(cameraYaw)*cameraSideOffset;
    target.x+=(followTargetX-target.x)*follow;
    target.z+=(followTargetZ-target.z)*follow;
    updateCamera();
    renderer.render(scene,camera);
  }
  requestAnimationFrame(animate);
})();
