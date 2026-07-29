const socket = io('/slither');
const canvas = document.getElementById('slitherCanvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimapCanvas');
const miniCtx = minimapCanvas.getContext('2d');

// ─── Estado del Juego ────────────────────────────────────────────────────────
let prevState = null;      // Estado del tick anterior (para interpolar)
let nextState = null;      // Estado del tick más reciente
let lastTickTime = 0;      // Timestamp cuando llegó el último tick
const TICK_RATE = 25;      // ms entre ticks (igual que en servidor)

let gameState = null;
let currentMode = 'multiplayer';
let isBoosting = false;
let mySnakeId = null;
let cameraX = 1500;
let cameraY = 1500;
let isDead = false;          // Indica que el jugador murió y está en modo espectador
let spectatorPos = null;     // Última posición conocida para cámara de espectador

// Detecta si el dispositivo es táctil (móvil/tablet)
const isMobileDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

// ─── Elementos UI ────────────────────────────────────────────────────────────
const menuScreen     = document.getElementById('menuScreen');
const gameHud        = document.getElementById('gameHud');
const gameOverOverlay = document.getElementById('gameOverOverlay');
const aliasInput     = document.getElementById('aliasInput');
const playMultiBtn   = document.getElementById('playMultiBtn');
const playSoloBtn    = document.getElementById('playSoloBtn');
const respawnBtn     = document.getElementById('respawnBtn');
const backMenuBtn    = document.getElementById('backMenuBtn');
const lbList         = document.getElementById('lbList');
const scoreVal       = document.getElementById('scoreVal');
const modeVal        = document.getElementById('modeVal');
const finalScoreVal  = document.getElementById('finalScoreVal');
const mobileAccelerateBtn = document.getElementById('mobileAccelerateBtn');
const joystickZone        = document.getElementById('joystickZone');
const joystickStick       = document.getElementById('joystickStick');
const boostBarFill        = document.getElementById('boostBarFill');

// ─── Estado del Joystick Virtual ─────────────────────────────────────────────
let joystickActive    = false;
let joystickTouchId   = null;
let joystickBaseX     = 0;    // centro del base en pantalla
let joystickBaseY     = 0;
const JOYSTICK_RADIUS = 60;
const STICK_LIMIT     = 37;
const JOYSTICK_DEAD   = 12;
let joystickAngle     = null;
let joystickTurnPower = 1;
let lastJoystickAngle = 0;

if (localStorage.getItem('neonAlias')) {
    aliasInput.value = localStorage.getItem('neonAlias');
}

function resizeCanvas() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function getAlias() {
    const name = aliasInput.value.trim();
    if (name) localStorage.setItem('neonAlias', name);
    return name;
}

playMultiBtn.addEventListener('click', () => startGame('multiplayer'));
playSoloBtn.addEventListener('click',  () => startGame('solo'));

function startGame(mode) {
    currentMode = mode;
    const alias = getAlias();

    socket.emit('joinGame', { alias, mode }, (res) => {
        if (res && res.success) {
            mySnakeId = res.snakeId;
            menuScreen.style.display = 'none';
            gameHud.style.display    = 'block';
            gameOverOverlay.classList.add('hidden');
            modeVal.innerText = mode === 'solo' ? 'SOLITARIO (BOTS)' : 'MULTIJUGADOR';
        }
    });
}

respawnBtn.addEventListener('click', () => {
    const alias = getAlias();
    socket.emit('respawn', { alias }, (res) => {
        if (res && res.success) {
            prevState = null;
            nextState = null;
            isDead = false;
            spectatorPos = null;
            gameOverOverlay.classList.add('hidden');
        }
    });
});

backMenuBtn.addEventListener('click', () => {
    gameOverOverlay.classList.add('hidden');
    gameHud.style.display  = 'none';
    menuScreen.style.display = 'flex';
});

// ─── Controles Mouse & Touch ─────────────────────────────────────────────────
let mouseX = window.innerWidth  / 2;
let mouseY = window.innerHeight / 2;

window.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
});

window.addEventListener('mousedown', () => { isBoosting = true;  });
window.addEventListener('mouseup',   () => { isBoosting = false; });

// ─── Botón Acelerador Móvil ───────────────────────────────────────────────────
mobileAccelerateBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isBoosting = true;
}, { passive: false });
mobileAccelerateBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    isBoosting = false;
}, { passive: false });
mobileAccelerateBtn.addEventListener('touchcancel', (e) => {
    isBoosting = false;
}, { passive: true });

// ─── Joystick Virtual ────────────────────────────────────────────────────────
function getJoystickRect() {
    return joystickZone.getBoundingClientRect();
}

joystickZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (joystickActive) return; // solo un dedo en el joystick
    const touch = e.changedTouches[0];
    joystickTouchId = touch.identifier;
    joystickActive  = true;
    const rect = getJoystickRect();
    joystickBaseX = rect.left + rect.width  / 2;
    joystickBaseY = rect.top  + rect.height / 2;
    updateJoystick(touch.clientX, touch.clientY);
}, { passive: false });

joystickZone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const touch of e.changedTouches) {
        if (touch.identifier === joystickTouchId) {
            updateJoystick(touch.clientX, touch.clientY);
            break;
        }
    }
}, { passive: false });

joystickZone.addEventListener('touchend', (e) => {
    for (const touch of e.changedTouches) {
        if (touch.identifier === joystickTouchId) {
            joystickActive  = false;
            joystickTouchId = null;
            joystickAngle   = null;
            joystickTurnPower = 1;
            joystickStick.style.transform = 'translate(0px, 0px)';
            break;
        }
    }
}, { passive: true });

joystickZone.addEventListener('touchcancel', () => {
    joystickActive  = false;
    joystickTouchId = null;
    joystickAngle   = null;
    joystickTurnPower = 1;
    joystickStick.style.transform = 'translate(0px, 0px)';
}, { passive: true });

function updateJoystick(cx, cy) {
    const dx = cx - joystickBaseX;
    const dy = cy - joystickBaseY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < JOYSTICK_DEAD) {
        joystickAngle = lastJoystickAngle;
        joystickTurnPower = 0.35;
        joystickStick.style.transform = 'translate(0px, 0px)';
        return;
    }

    const clampedDist = Math.min(dist, STICK_LIMIT);
    const angle = Math.atan2(dy, dx);
    joystickAngle = angle;
    lastJoystickAngle = angle;
    joystickTurnPower = 0.35 + 0.65 * (clampedDist / STICK_LIMIT);
    const sx = Math.cos(angle) * clampedDist;
    const sy = Math.sin(angle) * clampedDist;
    joystickStick.style.transform = `translate(${sx}px, ${sy}px)`;
}

// Touchmove general: solo actualiza mouse en pantallas NO móviles / dedos fuera del joystick
window.addEventListener('touchmove', (e) => {
    // Si hay joystick activo, no sobreescribir el ángulo con el touch general
    for (const touch of e.touches) {
        if (joystickActive && touch.identifier === joystickTouchId) continue;
        mouseX = touch.clientX;
        mouseY = touch.clientY;
        break;
    }
}, { passive: true });

// Enviar dirección cada frame (en lugar de solo en eventos) para respuesta inmediata
function sendDirection() {
    if (!mySnakeId || isDead) return; // No enviar si estamos muertos (espectador)
    let targetAngle;
    if (joystickActive && joystickAngle !== null) {
        // Joystick activo: usar ángulo calculado por el joystick
        targetAngle = joystickAngle;
    } else if (isMobileDevice) {
        // En móvil sin joystick activo: no actualizar dirección
        // El servidor mantiene el último ángulo recibido → serpiente sigue recta
        return;
    } else {
        const centerX = window.innerWidth  / 2;
        const centerY = window.innerHeight / 2;
        const dx = mouseX - centerX;
        const dy = mouseY - centerY;
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
        targetAngle = Math.atan2(dy, dx);
    }
    socket.emit('updateInput', {
        targetAngle,
        boosting: isBoosting,
        turnPower: joystickActive ? joystickTurnPower : 1
    });
}

// ─── Recepción de ticks del servidor ─────────────────────────────────────────
// Mapa para interpolar posiciones de pellets atraídos por el imán
const pelletPrevPos = new Map(); // pelletId → { x, y }

socket.on('tickState', (data) => {
    // Antes de actualizar, guardar posiciones previas de pellets para interpolación
    if (nextState && nextState.pellets) {
        for (const p of nextState.pellets) {
            pelletPrevPos.set(p.id, { x: p.x, y: p.y });
        }
    }

    prevState    = nextState || data;
    nextState    = data;
    lastTickTime = performance.now();
    gameState    = data;

    // Actualizar posición de cámara espectador si estamos muertos
    if (data.spectating && data.spectatorPos) {
        spectatorPos = data.spectatorPos;
    }

    // Actualizar HUD de score
    if (data.me) {
        scoreVal.innerText = data.me.score;

        // Actualizar barra de energía boost
        // El score mínimo para boost es 100 (0% energía). Definimos 1500 como 100% de energía visible en barra.
        if (boostBarFill) {
            const MIN_SCORE = 100;
            const MAX_DISPLAY_SCORE = 1500;
            const pct = Math.min(100, Math.max(0, ((data.me.score - MIN_SCORE) / (MAX_DISPLAY_SCORE - MIN_SCORE)) * 100));
            boostBarFill.style.width = pct + '%';
            // Color: verde cuando llena, naranja cuando baja, rojo cuando crítica
            if (pct > 50) {
                boostBarFill.style.background = 'linear-gradient(90deg, #39ff14, #00ffaa)';
            } else if (pct > 20) {
                boostBarFill.style.background = 'linear-gradient(90deg, #ffaa00, #ffd700)';
            } else {
                boostBarFill.style.background = 'linear-gradient(90deg, #ff0055, #ff4400)';
            }
        }
    }
    if (data.leaderboard) {
        renderLeaderboard(data.leaderboard);
    }
});

socket.on('gameOver', ({ finalScore }) => {
    isDead = true;
    finalScoreVal.innerText = finalScore;
    gameOverOverlay.classList.remove('hidden');
});

function renderLeaderboard(board) {
    lbList.innerHTML = '';
    board.forEach(item => {
        const li = document.createElement('li');
        const isMe = item.id === mySnakeId;
        li.style.color      = isMe ? '#39ff14' : (item.isBot ? '#94a3b8' : '#fff');
        li.style.fontWeight = isMe ? '700' : 'normal';
        li.innerText = `${item.name}: ${item.score}`;
        lbList.appendChild(li);
    });
}

// ─── Interpolación lineal de posiciones ──────────────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Dado un array de serpientes en prevState y nextState,
 * devuelve un array interpolado según alpha (0=prev, 1=next).
 */
function interpolateSnakes(prevSnakes, nextSnakes, alpha) {
    if (!prevSnakes || !nextSnakes) return nextSnakes || [];

    // Construir mapa de prev por id para búsqueda rápida
    const prevMap = new Map(prevSnakes.map(s => [s.id, s]));

    return nextSnakes.map(next => {
        const prev = prevMap.get(next.id);
        if (!prev) return next; // serpiente nueva: sin interpolar

        // Interpolar cabeza
        const ix = lerp(prev.x, next.x, alpha);
        const iy = lerp(prev.y, next.y, alpha);

        // Interpolar segmentos del cuerpo
        let iBody = next.body;
        if (prev.body && next.body) {
            const minLength = Math.min(prev.body.length, next.body.length);
            iBody = next.body.map((seg, i) => {
                if (i < minLength) {
                    const ps = prev.body[i];
                    return ps
                        ? { x: lerp(ps.x, seg.x, alpha), y: lerp(ps.y, seg.y, alpha) }
                        : seg;
                }
                return seg;
            });
        }

        let growthHole = next.growthHole || null;
        if (prev.growthHole && next.growthHole) {
            growthHole = {
                x: lerp(prev.growthHole.x, next.growthHole.x, alpha),
                y: lerp(prev.growthHole.y, next.growthHole.y, alpha),
                fade: lerp(prev.growthHole.fade || 0, next.growthHole.fade || 0, alpha)
            };
        }

        return { ...next, x: ix, y: iy, body: iBody, shield: lerp(prev.shield || 0, next.shield || 0, alpha), growthHole };
    });
}

function getSnakeBodyWidth(score) {
    return Math.min(32, 18 + score / 100);
}

function drawHexagonPath(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
}

function drawArenaBackground(ctx, offsetX, offsetY, worldSize) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const sky = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(canvas.width, canvas.height) * 0.85);
    sky.addColorStop(0, '#9ef2ff');
    sky.addColorStop(0.55, '#6fe3f8');
    sky.addColorStop(1, '#45c4e8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const arena = ctx.createLinearGradient(offsetX, offsetY, offsetX + worldSize, offsetY + worldSize);
    arena.addColorStop(0, '#72dff5');
    arena.addColorStop(0.5, '#8ae9ff');
    arena.addColorStop(1, '#5ecfee');
    ctx.fillStyle = arena;
    ctx.fillRect(offsetX, offsetY, worldSize, worldSize);

    const hexR = 38;
    const hexW = Math.sqrt(3) * hexR;
    const rowH = hexR * 1.5;

    ctx.save();
    ctx.beginPath();
    ctx.rect(offsetX, offsetY, worldSize, worldSize);
    ctx.clip();

    const colStart = Math.floor((-offsetX - hexW) / hexW) - 1;
    const colEnd = colStart + Math.ceil((canvas.width + hexW * 2) / hexW) + 2;
    const rowStart = Math.floor((-offsetY - rowH) / rowH) - 1;
    const rowEnd = rowStart + Math.ceil((canvas.height + rowH * 2) / rowH) + 2;

    for (let row = rowStart; row <= rowEnd; row++) {
        for (let col = colStart; col <= colEnd; col++) {
            const hx = offsetX + col * hexW + (row % 2 === 0 ? 0 : hexW / 2);
            const hy = offsetY + row * rowH;
            if (hx < offsetX - hexR || hx > offsetX + worldSize + hexR) continue;
            if (hy < offsetY - hexR || hy > offsetY + worldSize + hexR) continue;

            drawHexagonPath(ctx, hx, hy, hexR - 1.5);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.11)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)';
            ctx.lineWidth = 1.15;
            ctx.stroke();

            drawHexagonPath(ctx, hx, hy, hexR * 0.55);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.fill();
        }
    }
    ctx.restore();
}

function drawArenaGrowthHole(ctx, snake, offsetX, offsetY) {
    const hole = snake.growthHole;
    if (!hole) return;

    const w = getSnakeBodyWidth(snake.score);
    const radius = w * 0.58;
    const fade = hole.fade || 0;
    const alpha = 1 - fade * 0.85;
    const hx = hole.x + offsetX;
    const hy = hole.y + offsetY;

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.fillStyle = 'rgba(20, 45, 58, 0.25)';
    ctx.beginPath();
    ctx.arc(hx, hy, radius * 1.35, 0, Math.PI * 2);
    ctx.fill();

    const pit = ctx.createRadialGradient(hx, hy, 0, hx, hy, radius * 1.25);
    pit.addColorStop(0, '#0a1620');
    pit.addColorStop(0.45, '#132a38');
    pit.addColorStop(0.78, '#1e4456');
    pit.addColorStop(1, 'rgba(94, 207, 238, 0.35)');
    ctx.fillStyle = pit;
    ctx.beginPath();
    ctx.arc(hx, hy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = Math.max(2, w * 0.09);
    ctx.beginPath();
    ctx.arc(hx, hy, radius * 0.95, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx, hy, radius * 1.08, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
}

function drawTailIntoArenaHole(ctx, snake, offsetX, offsetY) {
    if (!snake.growthHole || !snake.body || snake.body.length < 2) return;

    const hole = snake.growthHole;
    const tail = snake.body[snake.body.length - 1];
    const w = getSnakeBodyWidth(snake.score);
    const hx = hole.x + offsetX;
    const hy = hole.y + offsetY;
    const tx = tail.x + offsetX;
    const ty = tail.y + offsetY;
    const fade = 1 - (hole.fade || 0) * 0.85;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = snake.color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 8;
    ctx.shadowColor = snake.color;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.restore();
}

function maskTailIntoArenaHole(ctx, snake, offsetX, offsetY) {
    if (!snake.growthHole || !snake.body || snake.body.length < 1) return;

    const hole = snake.growthHole;
    const tail = snake.body[snake.body.length - 1];
    const w = getSnakeBodyWidth(snake.score);
    const hx = hole.x + offsetX;
    const hy = hole.y + offsetY;
    const tx = tail.x + offsetX;
    const ty = tail.y + offsetY;

    ctx.save();
    const pit = ctx.createRadialGradient(hx, hy, 0, hx, hy, w * 0.55);
    pit.addColorStop(0, '#0a1620');
    pit.addColorStop(0.7, '#132a38');
    pit.addColorStop(1, 'rgba(19, 42, 56, 0.95)');
    ctx.fillStyle = pit;
    ctx.beginPath();
    ctx.arc(tx, ty, w * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/** Brillo en cola mientras dura el escudo de aparición */
function drawSpawnShieldTail(ctx, snake, offsetX, offsetY) {
    const shield = snake.shield;
    if (!shield || shield <= 0.02 || !snake.body || snake.body.length < 2) return;

    const w = getSnakeBodyWidth(snake.score);
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 110);
    const tailStart = Math.max(0, Math.floor(snake.body.length * 0.45));

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = w + 6 * shield * pulse;
    ctx.globalAlpha = shield * (0.42 + 0.28 * pulse);
    ctx.shadowBlur = 22 * shield;
    ctx.shadowColor = '#ffffff';

    const hueShift = (performance.now() / 40) % 360;
    const grad = ctx.createLinearGradient(
        snake.x + offsetX, snake.y + offsetY,
        snake.body[snake.body.length - 1].x + offsetX,
        snake.body[snake.body.length - 1].y + offsetY
    );
    grad.addColorStop(0, `hsla(${hueShift}, 100%, 75%, 0.15)`);
    grad.addColorStop(0.35, `hsla(${(hueShift + 80) % 360}, 100%, 80%, 0.85)`);
    grad.addColorStop(0.7, `hsla(${(hueShift + 160) % 360}, 100%, 85%, 1)`);
    grad.addColorStop(1, '#ffffff');
    ctx.strokeStyle = grad;

    ctx.beginPath();
    ctx.moveTo(snake.body[tailStart].x + offsetX, snake.body[tailStart].y + offsetY);
    for (let i = tailStart + 1; i < snake.body.length; i++) {
        ctx.lineTo(snake.body[i].x + offsetX, snake.body[i].y + offsetY);
    }
    const tail = snake.body[snake.body.length - 1];
    ctx.lineTo(tail.x + offsetX, tail.y + offsetY);
    ctx.stroke();
    ctx.restore();
}

// ─── Bucle de Renderizado (60 FPS) ───────────────────────────────────────────
function renderLoop() {
    requestAnimationFrame(renderLoop);

    // Enviar dirección cada frame → latencia mínima de respuesta
    sendDirection();

    // Fondo exterior (fuera del mapa)
    ctx.fillStyle = '#45c4e8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Necesitamos al menos un tickState recibido para renderizar
    if (!gameState) return;

    // Calcular alpha de interpolación (cuánto avanzamos entre el tick anterior y el siguiente)
    const now   = performance.now();
    const alpha = Math.min(1.0, (now - lastTickTime) / TICK_RATE);

    // Posición de la cámara: si está vivo sigue al jugador, si murió usa la posición del espectador
    let targetX, targetY;
    if (gameState.me) {
        const myPrev = prevState && prevState.me;
        const myNext = nextState && nextState.me;
        targetX = (myPrev && myNext) ? lerp(myPrev.x, myNext.x, alpha) : gameState.me.x;
        targetY = (myPrev && myNext) ? lerp(myPrev.y, myNext.y, alpha) : gameState.me.y;
    } else if (spectatorPos) {
        // Modo espectador: cámara fija en el punto donde murió
        targetX = spectatorPos.x;
        targetY = spectatorPos.y;
    } else {
        return; // Todavía no hay estado
    }

    // Cámara más suave (lerp 0.07 en lugar de 0.15)
    cameraX += (targetX - cameraX) * 0.07;
    cameraY += (targetY - cameraY) * 0.07;

    const offsetX = canvas.width  / 2 - cameraX;
    const offsetY = canvas.height / 2 - cameraY;

    drawArenaBackground(ctx, offsetX, offsetY, gameState.worldSize);

    // ── Límites del Mundo ────────────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = '#d94b4b';
    ctx.lineWidth   = 5;
    ctx.shadowBlur  = 12;
    ctx.shadowColor = 'rgba(217, 75, 75, 0.45)';
    ctx.strokeRect(offsetX, offsetY, gameState.worldSize, gameState.worldSize);
    ctx.restore();

    // ── Pellets (Orbes Neón) con efecto imán ─────────────────────────────────
    if (gameState.pellets) {
        // Construir mapa de pellets del tick anterior para interpolación
        const prevPelletMap = new Map();
        if (prevState && prevState.pellets) {
            for (const p of prevState.pellets) prevPelletMap.set(p.id, p);
        }

        // Radio visual del imán (en coordenadas de mundo)
        const MAGNET_VIS_RADIUS = 105;
        const MOUTH_VIS_OFFSET = 18;

        // Cabeza de mi serpiente en coordenadas de mundo (para calcular atracción visual)
        let myHeadX = null, myHeadY = null;
        if (gameState.me && nextState && nextState.me) {
            myHeadX = lerp(prevState && prevState.me ? prevState.me.x : nextState.me.x, nextState.me.x, alpha);
            myHeadY = lerp(prevState && prevState.me ? prevState.me.y : nextState.me.y, nextState.me.y, alpha);
            const prevSnake = prevState && prevState.snakes && prevState.snakes.find(s => s.id === mySnakeId);
            const nextSnake = nextState.snakes && nextState.snakes.find(s => s.id === mySnakeId);
            let headAngle = nextSnake ? nextSnake.angle : 0;
            if (prevSnake && nextSnake) headAngle = lerp(prevSnake.angle, nextSnake.angle, alpha);
            myHeadX += Math.cos(headAngle) * MOUTH_VIS_OFFSET;
            myHeadY += Math.sin(headAngle) * MOUTH_VIS_OFFSET;
        }

        gameState.pellets.forEach(p => {
            // Interpolar posición del pellet entre ticks si se está moviendo (atraído)
            const prev = prevPelletMap.get(p.id);
            let px, py;
            if (prev && (Math.abs(p.x - prev.x) > 0.5 || Math.abs(p.y - prev.y) > 0.5)) {
                // Pellet se está moviendo (posiblemente atraído) → interpolar suavemente
                px = (lerp(prev.x, p.x, alpha) + offsetX);
                py = (lerp(prev.y, p.y, alpha) + offsetY);
            } else {
                px = p.x + offsetX;
                py = p.y + offsetY;
            }

            // Calcular si este pellet está siendo atraído (cerca de mi cabeza)
            let magnetized = false;
            if (myHeadX !== null) {
                const distToHead = Math.hypot(p.x - myHeadX, p.y - myHeadY);
                magnetized = distToHead < MAGNET_VIS_RADIUS;
            }

            ctx.save();
            ctx.fillStyle   = p.color;

            if (magnetized) {
                // Efecto de brillo extra + estela para pellets atraídos
                ctx.shadowBlur  = p.radius * 5;
                ctx.shadowColor = p.color;
                ctx.globalAlpha = 0.9;
            } else {
                ctx.shadowBlur  = p.radius * 2;
                ctx.shadowColor = p.color;
            }

            ctx.beginPath();
            ctx.arc(px, py, magnetized ? p.radius * 1.15 : p.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
    }

    // ── Serpientes con Interpolación ─────────────────────────────────────────
    const snakesToRender = interpolateSnakes(
        prevState && prevState.snakes,
        nextState && nextState.snakes,
        alpha
    );

    if (snakesToRender) {
        snakesToRender.forEach(snake => {
            if (snake.growthHole) drawArenaGrowthHole(ctx, snake, offsetX, offsetY);
        });

        snakesToRender.forEach(snake => {
            const isMe = snake.id === mySnakeId;

            if (snake.growthHole) drawTailIntoArenaHole(ctx, snake, offsetX, offsetY);

            // Cuerpo
            if (snake.body && snake.body.length > 0) {
                ctx.save();
                ctx.strokeStyle = snake.color;
                ctx.lineWidth   = getSnakeBodyWidth(snake.score);
                ctx.lineCap     = 'round';
                ctx.lineJoin    = 'round';
                ctx.shadowBlur  = isMe ? 18 : 10;
                ctx.shadowColor = snake.color;

                ctx.beginPath();
                ctx.moveTo(snake.x + offsetX, snake.y + offsetY);
                for (let i = 0; i < snake.body.length; i++) {
                    ctx.lineTo(snake.body[i].x + offsetX, snake.body[i].y + offsetY);
                }
                ctx.stroke();
                ctx.restore();
            }

            drawSpawnShieldTail(ctx, snake, offsetX, offsetY);
            if (snake.growthHole) maskTailIntoArenaHole(ctx, snake, offsetX, offsetY);

            // Cabeza (con ojos)
            const hx = snake.x + offsetX;
            const hy = snake.y + offsetY;

            ctx.save();
            ctx.translate(hx, hy);
            ctx.rotate(snake.angle);

            // Resplandor cabeza
            ctx.fillStyle   = '#ffffff';
            ctx.shadowBlur  = 15;
            ctx.shadowColor = snake.color;
            ctx.beginPath();
            ctx.arc(0, 0, Math.min(20, 11 + snake.score / 150), 0, Math.PI * 2);
            ctx.fill();

            // Ojos (escalados para cabeza más gruesa tipo Snake.io)
            ctx.fillStyle = '#1a2a35';
            ctx.shadowBlur = 0;
            ctx.beginPath();
            ctx.arc(5, -6, 3.5, 0, Math.PI * 2);
            ctx.arc(5,  6, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // Alias sobre la serpiente
            ctx.save();
            ctx.font      = 'bold 12px Orbitron, sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.shadowBlur  = 8;
            ctx.shadowColor = '#000';
            ctx.fillText(snake.name, hx, hy - 20);
            ctx.restore();
        });
    }

    // ── Minimapa ─────────────────────────────────────────────────────────────
    renderMinimap();
}

function renderMinimap() {
    miniCtx.fillStyle = '#6fe3f8';
    miniCtx.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);

    if (!gameState || !gameState.snakes) return;

    const scale = minimapCanvas.width / gameState.worldSize;

    gameState.snakes.forEach(s => {
        const mx   = s.x * scale;
        const my   = s.y * scale;
        const isMe = s.id === mySnakeId;

        miniCtx.fillStyle = isMe ? '#39ff14' : '#ff0055';
        miniCtx.beginPath();
        miniCtx.arc(mx, my, isMe ? 3.5 : 2, 0, Math.PI * 2);
        miniCtx.fill();
    });
}

requestAnimationFrame(renderLoop);
