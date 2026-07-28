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
const JOYSTICK_RADIUS = 60;   // radio del base (en px)
const STICK_LIMIT     = 37;   // máx. desplazamiento del stick
let joystickAngle     = null; // null → usa mouseX/mouseY

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
            joystickStick.style.transform = 'translate(0px, 0px)';
            break;
        }
    }
}, { passive: true });

joystickZone.addEventListener('touchcancel', () => {
    joystickActive  = false;
    joystickTouchId = null;
    joystickAngle   = null;
    joystickStick.style.transform = 'translate(0px, 0px)';
}, { passive: true });

function updateJoystick(cx, cy) {
    const dx = cx - joystickBaseX;
    const dy = cy - joystickBaseY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const clampedDist = Math.min(dist, STICK_LIMIT);
    const angle = Math.atan2(dy, dx);
    joystickAngle = angle; // guardar ángulo para sendDirection
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
    } else {
        const centerX = window.innerWidth  / 2;
        const centerY = window.innerHeight / 2;
        const dx = mouseX - centerX;
        const dy = mouseY - centerY;
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
        targetAngle = Math.atan2(dy, dx);
    }
    socket.emit('updateInput', { targetAngle, boosting: isBoosting });
}

// ─── Recepción de ticks del servidor ─────────────────────────────────────────
socket.on('tickState', (data) => {
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

        return { ...next, x: ix, y: iy, body: iBody };
    });
}

// ─── Bucle de Renderizado (60 FPS) ───────────────────────────────────────────
function renderLoop() {
    requestAnimationFrame(renderLoop);

    // Enviar dirección cada frame → latencia mínima de respuesta
    sendDirection();

    // Fondo
    ctx.fillStyle = '#04060f';
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

    // ── Rejilla de Fondo Neón ────────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = 'rgba(57, 255, 20, 0.04)';
    ctx.lineWidth = 1;
    const gridSize = 60;
    const startX = (offsetX % gridSize) - gridSize;
    const startY = (offsetY % gridSize) - gridSize;

    ctx.beginPath();
    for (let x = startX; x < canvas.width + gridSize; x += gridSize) {
        ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
    }
    for (let y = startY; y < canvas.height + gridSize; y += gridSize) {
        ctx.moveTo(0, y); ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();
    ctx.restore();

    // ── Límites del Mundo ────────────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = '#ff0055';
    ctx.lineWidth   = 6;
    ctx.shadowBlur  = 20;
    ctx.shadowColor = '#ff0055';
    ctx.strokeRect(offsetX, offsetY, gameState.worldSize, gameState.worldSize);
    ctx.restore();

    // ── Pellets (Orbes Neón) ─────────────────────────────────────────────────
    if (gameState.pellets) {
        gameState.pellets.forEach(p => {
            const px = p.x + offsetX;
            const py = p.y + offsetY;

            ctx.save();
            ctx.fillStyle   = p.color;
            ctx.shadowBlur  = p.radius * 2;
            ctx.shadowColor = p.color;
            ctx.beginPath();
            ctx.arc(px, py, p.radius, 0, Math.PI * 2);
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
            const isMe = snake.id === mySnakeId;

            // Cuerpo
            if (snake.body && snake.body.length > 0) {
                ctx.save();
                ctx.strokeStyle = snake.color;
                ctx.lineWidth   = Math.min(32, 18 + snake.score / 100);
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
            ctx.fillStyle = '#04060f';
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
    miniCtx.fillStyle = '#04060f';
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
