const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const gridSize = 10;

let myRole = '';
let currentRoomId = null;
let latestState = null;
let particles = [];
let floatingReactions = [];
let previousStatus = 'waiting';
let previousCountdown = -1;
let currentConfig = { winsLimit: 3 };
let currentGameData = null;
let witchPulse = 0; // para animación de bruja

// --- ELEMENTOS DEL DOM ---
const lobbyScreen = document.getElementById('lobbyScreen');
const gameContainer = document.getElementById('gameContainer');
const matchOverlay = document.getElementById('matchOverlay');
const aliasInput = document.getElementById('aliasInput');
const roomNameInput = document.getElementById('roomNameInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinCodeBtn = document.getElementById('joinCodeBtn');
const roomsListContainer = document.getElementById('roomsListContainer');
const currentRoomCode = document.getElementById('currentRoomCode');
const currentRoomName = document.getElementById('currentRoomName');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');
const toast = document.getElementById('toast');
const livesP1El = document.getElementById('livesP1');
const livesP2El = document.getElementById('livesP2');
const winsLimitValEl = document.getElementById('winsLimitVal');
const joinCard = document.getElementById('joinCard');

// Pre-cargar Alias guardado en localStorage (si existe)
if (localStorage.getItem('neonAlias')) {
    aliasInput.value = localStorage.getItem('neonAlias');
}

// Detectar parámetro ?room=CÓDIGO en la URL
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room');
if (roomParam) {
    roomCodeInput.value = roomParam.toUpperCase();
    if (joinCard) {
        joinCard.classList.add('pre-filled');
    }
}

function getAlias() {
    const name = aliasInput.value.trim();
    if (name) localStorage.setItem('neonAlias', name);
    return name;
}

function showToast(msg) {
    toast.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2800);
}

function copyRoomCodeToClipboard(code) {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
        showToast(`¡Código ${code} copiado al portapapeles! 📋`);
    }).catch(() => {
        showToast(`Código: ${code}`);
    });
}

// --- SELECTOR WINS LIMIT ---
let selectedWinsLimit = 3;
document.querySelectorAll('.wins-opt').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.wins-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedWinsLimit = parseInt(btn.getAttribute('data-wins'));
    });
});

// --- SISTEMA DE AUDIO (Web Audio API) ---
class SoundEngine {
    constructor() {
        this.ctx = null;
    }
    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }
    playTurn() {
        if (!this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(440, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.08);
            gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.08);
        } catch (e) {}
    }
    playBeep(high = false) {
        if (!this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(high ? 880 : 440, this.ctx.currentTime);
            gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.15);
        } catch (e) {}
    }
    playExplosion() {
        if (!this.ctx) return;
        try {
            const bufferSize = this.ctx.sampleRate * 0.4;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }
            const noise = this.ctx.createBufferSource();
            noise.buffer = buffer;

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(800, this.ctx.currentTime);
            filter.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.4);

            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);

            noise.connect(filter);
            filter.connect(gain);
            gain.connect(this.ctx.destination);

            noise.start();
            noise.stop(this.ctx.currentTime + 0.4);
        } catch (e) {}
    }
    playReactionSound() {
        if (!this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1046.50, this.ctx.currentTime + 0.15);
            gain.gain.setValueAtTime(0.18, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.15);
        } catch (e) {}
    }
    playWitch() {
        if (!this.ctx) return;
        try {
            // Sonido mágico: arpeggio ascendente en Do mayor
            const freqs = [523.25, 659.25, 783.99, 1046.50];
            freqs.forEach((f, i) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(f, this.ctx.currentTime + i * 0.06);
                gain.gain.setValueAtTime(0, this.ctx.currentTime + i * 0.06);
                gain.gain.linearRampToValueAtTime(0.22, this.ctx.currentTime + i * 0.06 + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + i * 0.06 + 0.18);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(this.ctx.currentTime + i * 0.06);
                osc.stop(this.ctx.currentTime + i * 0.06 + 0.2);
            });
        } catch (e) {}
    }
    playVictory() {
        if (!this.ctx) return;
        try {
            // Fanfarria épica: acorde de Do mayor + sweep
            const chordFreqs = [261.63, 329.63, 392.00, 523.25];
            chordFreqs.forEach((f) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'square';
                osc.frequency.setValueAtTime(f, this.ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(f * 2, this.ctx.currentTime + 0.6);
                gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 1.0);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start();
                osc.stop(this.ctx.currentTime + 1.0);
            });
            // Sweep descendente de celebración
            const sw = this.ctx.createOscillator();
            const swGain = this.ctx.createGain();
            sw.type = 'sawtooth';
            sw.frequency.setValueAtTime(1800, this.ctx.currentTime + 0.5);
            sw.frequency.exponentialRampToValueAtTime(200, this.ctx.currentTime + 1.2);
            swGain.gain.setValueAtTime(0.08, this.ctx.currentTime + 0.5);
            swGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 1.3);
            sw.connect(swGain);
            swGain.connect(this.ctx.destination);
            sw.start(this.ctx.currentTime + 0.5);
            sw.stop(this.ctx.currentTime + 1.3);
        } catch (e) {}
    }
}
const audio = new SoundEngine();

document.addEventListener('pointerdown', () => audio.init(), { once: true });

// --- GESTIÓN DE SALAS Y CONEXIÓN ---

// Medición de latencia / ping
setInterval(() => {
    if (!currentRoomId) return;
    const start = Date.now();
    socket.emit('pingCheck', () => {
        const latency = Date.now() - start;
        document.getElementById('pingVal').innerText = latency;
    });
}, 3000);

socket.on('disconnect', () => {
    showToast('⚠️ Conexión perdida con el servidor.');
    leaveGameUI();
});

// Recepción de lista de salas activas
socket.on('roomsList', (rooms) => {
    renderRoomsList(rooms);
});

function renderRoomsList(rooms) {
    roomsListContainer.innerHTML = '';

    if (!rooms || rooms.length === 0) {
        roomsListContainer.innerHTML = '<div class="no-rooms-msg">No hay salas activas en este momento. ¡Crea la primera!</div>';
        return;
    }

    rooms.forEach(room => {
        const item = document.createElement('div');
        item.className = 'room-item';

        const isFull = room.playerCount >= 2;
        const statusText = room.status === 'playing' ? 'En Juego' : (isFull ? 'Llena' : 'Esperando');
        const statusClass = room.status === 'playing' ? 'status-playing' : 'status-waiting';

        item.innerHTML = `
            <div class="room-info">
                <div class="room-name-row">
                    <span class="room-name">${escapeHTML(room.name)}</span>
                    <span class="room-code-badge clickable-badge" title="Haz clic para copiar el código 📋">${room.id}</span>
                    ${room.winsLimit ? `<span class="wins-limit-tag">🏆${room.winsLimit}</span>` : ''}
                </div>
                <div class="room-details">
                    <span>👥 ${room.p1Name} vs ${room.p2Name}</span>
                    <span>👁️ ${room.spectatorCount} espectando</span>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </div>
            </div>
            <div>
                <button class="cyber-btn ${isFull ? 'cyber-btn-secondary' : ''}" style="padding: 6px 12px; font-size: 12px;">
                    ${isFull ? 'ESPECTAR 👁️' : 'UNIRSE 🎮'}
                </button>
            </div>
        `;

        // Copiar código de sala desde la tarjeta del lobby
        item.querySelector('.room-code-badge').addEventListener('click', (e) => {
            e.stopPropagation();
            copyRoomCodeToClipboard(room.id);
        });

        // Entrar o Espectar la sala
        item.querySelector('button').addEventListener('click', () => {
            joinRoom(room.id);
        });

        roomsListContainer.appendChild(item);
    });
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

// Crear nueva sala
createRoomBtn.addEventListener('click', () => {
    audio.init();
    const alias = getAlias();
    const roomName = roomNameInput.value.trim();
    const winsLimit = selectedWinsLimit;

    socket.emit('createRoom', { roomName, alias, winsLimit }, (res) => {
        if (res && res.success) {
            if (res.config) currentConfig = res.config;
            enterGameUI(res);
            showToast(`¡Sala ${res.roomId} creada con éxito!`);
        } else {
            showToast('Error al crear la sala.');
        }
    });
});

// Unirse a sala con código
joinCodeBtn.addEventListener('click', () => {
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!code) {
        showToast('Ingresa un código de sala válido.');
        return;
    }
    joinRoom(code);
});

function joinRoom(roomId) {
    audio.init();
    const alias = getAlias();

    socket.emit('joinRoom', { roomId, alias }, (res) => {
        if (res && res.success) {
            if (res.config) currentConfig = res.config;
            enterGameUI(res);
            if (res.role === 'spectator') {
                showToast(`Te uniste a la sala ${res.roomId} como ESPECTADOR 👁️`);
            } else {
                showToast(`¡Te uniste a la sala ${res.roomId}!`);
            }
        } else {
            showToast(res.error || 'No se pudo ingresar a la sala.');
        }
    });
}

function enterGameUI(data) {
    currentRoomId = data.roomId;
    myRole = data.role;

    currentRoomCode.innerText = data.roomId;
    currentRoomName.innerText = data.roomName;

    if (data.config) {
        currentConfig = data.config;
        winsLimitValEl.innerText = data.config.winsLimit;
    }

    // Actualizar URL del navegador sin recargar para compartir el enlace fácilmente
    const newUrl = window.location.pathname + '?room=' + data.roomId;
    window.history.pushState({ path: newUrl }, '', newUrl);

    lobbyScreen.style.display = 'none';
    gameContainer.style.display = 'flex';
    matchOverlay.classList.add('hidden');

    if (myRole === 'p1' || myRole === 'p2') {
        const color = myRole === 'p1' ? '#00ffff' : '#ff00ff';
        document.querySelectorAll('.btn-dir').forEach(btn => {
            btn.style.borderColor = color;
        });
    }

    if (data.gameData) updateScoresUI(data.gameData);
    if (data.gameState) latestState = data.gameState;
}

function leaveGameUI() {
    currentRoomId = null;
    myRole = '';
    latestState = null;
    particles = [];
    floatingReactions = [];
    currentGameData = null;

    // Limpiar parámetro de URL
    window.history.pushState({}, '', window.location.pathname);

    matchOverlay.classList.add('hidden');
    gameContainer.style.display = 'none';
    lobbyScreen.style.display = 'flex';
}

// Copiar Código de Sala al Portapapeles
copyCodeBtn.addEventListener('click', () => {
    if (currentRoomId) copyRoomCodeToClipboard(currentRoomId);
});

currentRoomCode.addEventListener('click', () => {
    if (currentRoomId) copyRoomCodeToClipboard(currentRoomId);
});

// Copiar Enlace Directo
copyLinkBtn.addEventListener('click', () => {
    if (!currentRoomId) return;
    const shareUrl = window.location.origin + window.location.pathname + '?room=' + currentRoomId;
    navigator.clipboard.writeText(shareUrl).then(() => {
        showToast('¡Enlace de invitación copiado al portapapeles! 📋');
    }).catch(() => {
        showToast(`Código de sala: ${currentRoomId}`);
    });
});

// Salir de la Sala
leaveRoomBtn.addEventListener('click', () => {
    if (confirm('ADVERTENCIA: Si sales de la sala se pausará o terminará el duelo actual. ¿Deseas continuar?')) {
        socket.emit('leaveRoom');
        leaveGameUI();
    }
});

// Overlay de Victoria: botones
document.getElementById('rematchBtn').addEventListener('click', () => {
    if (!currentRoomId) return;
    audio.init();
    socket.emit('rematch');
    matchOverlay.classList.add('hidden');
});

document.getElementById('backLobbyBtn').addEventListener('click', () => {
    socket.emit('leaveRoom');
    leaveGameUI();
});

// Advertencia al intentar cerrar o recargar la pestaña en medio de un duelo
window.addEventListener('beforeunload', (e) => {
    if (currentRoomId && latestState && latestState.status === 'playing') {
        e.preventDefault();
        e.returnValue = '¿Estás seguro de que deseas salir? El juego actual se pausará.';
    }
});

socket.on('leftRoom', () => {
    leaveGameUI();
});

// Recepción de configuración de sala
socket.on('roomConfig', (config) => {
    if (config) {
        currentConfig = config;
        winsLimitValEl.innerText = config.winsLimit;
    }
});

// --- RECEPCIÓN DE DATOS DE SALA ---
socket.on('updateData', (data) => {
    currentGameData = data;
    updateScoresUI(data);
});

function renderLives(el, count) {
    if (!el) return;
    const full = '❤️';
    const empty = '🖤';
    const maxLives = Math.max(count, 0);
    let html = '';
    // mostramos hasta 5 corazones para no desbordar el HUD
    const display = Math.min(maxLives, 7);
    for (let i = 0; i < display; i++) html += full;
    if (maxLives > 7) html += `+${maxLives - 7}`;
    if (maxLives === 0) html = '💀';
    el.innerHTML = html;
}

function updateScoresUI(data) {
    document.getElementById('nameP1').innerText = data.names.p1;
    document.getElementById('nameP2').innerText = data.names.p2;
    document.getElementById('scoreP1').innerText = data.scores.p1;
    document.getElementById('scoreP2').innerText = data.scores.p2;

    if (data.lives) {
        const prevP1 = currentGameData ? (currentGameData.lives || {}).p1 : null;
        const prevP2 = currentGameData ? (currentGameData.lives || {}).p2 : null;

        renderLives(livesP1El, data.lives.p1);
        renderLives(livesP2El, data.lives.p2);

        // Animación de pérdida de vida
        if (prevP1 !== null && data.lives.p1 < prevP1) {
            livesP1El.classList.remove('life-lost');
            void livesP1El.offsetWidth;
            livesP1El.classList.add('life-lost');
        }
        if (prevP2 !== null && data.lives.p2 < prevP2) {
            livesP2El.classList.remove('life-lost');
            void livesP2El.offsetWidth;
            livesP2El.classList.add('life-lost');
        }
    }

    currentGameData = data;
}

socket.on('state', (state) => {
    if (state.status === 'countdown' && state.countdownTime !== previousCountdown) {
        audio.playBeep(state.countdownTime === 0);
        previousCountdown = state.countdownTime;
    }

    if (state.status === 'gameover' && previousStatus === 'playing') {
        audio.playExplosion();
        createExplosionParticles(state);
    }

    previousStatus = state.status;
    latestState = state;
});

// --- EVENTO VICTORIA DE PARTIDA ---
socket.on('matchWin', (data) => {
    audio.init();
    audio.playVictory();

    const { winner, winnerName, scores, lives, winsLimit, reason } = data;

    matchOverlay.className = 'match-overlay';
    matchOverlay.classList.add(`winner-${winner}`);

    const emojiEl = document.getElementById('matchWinnerEmoji');
    const nameEl = document.getElementById('matchWinnerName');
    const subtitleEl = document.getElementById('matchSubtitle');
    const scoreEl = document.getElementById('matchFinalScore');

    if (winner === 'draw') {
        emojiEl.textContent = '🤝';
        nameEl.textContent = '¡EMPATE ÉPICO!';
        subtitleEl.textContent = 'Ambos guerreros lo dieron todo';
    } else {
        emojiEl.textContent = '🏆';
        nameEl.textContent = winnerName;
        if (reason === 'lives') {
            subtitleEl.textContent = '¡Victoria por dejar al rival sin vidas!';
        } else {
            subtitleEl.textContent = `¡Primero en alcanzar ${winsLimit} victorias!`;
        }
    }

    scoreEl.textContent = `${scores.p1} — ${scores.p2}`;

    matchOverlay.classList.remove('hidden');

    // Explosión de partículas de celebración en canvas
    createVictoryParticles(winner);
});

// Revancha iniciada por el servidor (el otro jugador solicitó revancha)
socket.on('rematchStarted', (data) => {
    matchOverlay.classList.add('hidden');
    renderLives(livesP1El, 3);
    renderLives(livesP2El, 3);
    if (data && data.config) {
        currentConfig = data.config;
        winsLimitValEl.innerText = data.config.winsLimit;
    }
});

// Bruja recolectada: partículas moradas y texto flotante
socket.on('witchCollected', ({ by, lives }) => {
    audio.init();
    audio.playWitch();

    if (latestState) {
        const p = by === 'p1' ? latestState.p1 : latestState.p2;
        if (p) {
            const cx = p.x * gridSize + gridSize / 2;
            const cy = p.y * gridSize + gridSize / 2;
            createWitchCollectedEffect(cx, cy, by);
        }
    }

    // Actualizar corazones inmediatamente
    if (lives) {
        renderLives(livesP1El, lives.p1);
        renderLives(livesP2El, lives.p2);
    }
});

function createWitchCollectedEffect(cx, cy, role) {
    const color = '#bf00ff';
    for (let i = 0; i < 40; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 5 + 2;
        particles.push({
            x: cx, y: cy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: Math.random() * 5 + 2,
            color,
            alpha: 1,
            decay: Math.random() * 0.025 + 0.015
        });
    }

    // Texto flotante
    const heartColor = role === 'p1' ? '#00ffff' : '#ff00ff';
    floatingReactions.push({
        x: cx,
        y: cy - 10,
        emoji: '+❤️',
        alpha: 1,
        scale: 0.3,
        vy: -1.5,
        color: heartColor
    });
}

// --- RECEPCIÓN DE REACCIONES RÁPIDAS ---
socket.on('reaction', ({ role, emoji }) => {
    audio.playReactionSound();

    let rx = canvas.width / 2;
    let ry = canvas.height / 2;

    if (latestState) {
        if (role === 'p1' && latestState.p1) {
            rx = latestState.p1.x * gridSize + gridSize / 2;
            ry = latestState.p1.y * gridSize - 15;
        } else if (role === 'p2' && latestState.p2) {
            rx = latestState.p2.x * gridSize + gridSize / 2;
            ry = latestState.p2.y * gridSize - 15;
        }
    }

    floatingReactions.push({
        x: Math.max(30, Math.min(canvas.width - 30, rx)),
        y: Math.max(30, Math.min(canvas.height - 30, ry)),
        emoji: emoji,
        alpha: 1,
        scale: 0.3,
        vy: -1.2,
        color: role === 'p1' ? '#00ffff' : (role === 'p2' ? '#ff00ff' : '#ffffff')
    });
});

function sendReaction(emoji) {
    if (!currentRoomId) return;
    audio.init();
    socket.emit('reaction', emoji);
}

document.querySelectorAll('.btn-emoji').forEach(btn => {
    btn.addEventListener('click', () => {
        const emoji = btn.getAttribute('data-emoji');
        sendReaction(emoji);
    });
});

// --- SISTEMA DE PARTÍCULAS NEÓN ---
function createExplosionParticles(state) {
    const addP = (x, y, color) => {
        for (let i = 0; i < 35; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 6 + 2;
            particles.push({
                x: x * gridSize + gridSize / 2,
                y: y * gridSize + gridSize / 2,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: Math.random() * 4 + 2,
                color: color,
                alpha: 1,
                decay: Math.random() * 0.03 + 0.02
            });
        }
    };

    if (!state.p1.alive) addP(state.p1.x, state.p1.y, '#00ffff');
    if (!state.p2.alive) addP(state.p2.x, state.p2.y, '#ff00ff');
}

function createVictoryParticles(winner) {
    const colors = winner === 'p1'
        ? ['#00ffff', '#00aaff', '#ffffff']
        : winner === 'p2'
            ? ['#ff00ff', '#ff0066', '#ffffff']
            : ['#ffd700', '#ffffff', '#facc15'];

    for (let i = 0; i < 120; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 9 + 2;
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height * 0.5,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 2,
            size: Math.random() * 5 + 2,
            color: colors[Math.floor(Math.random() * colors.length)],
            alpha: 1,
            decay: Math.random() * 0.012 + 0.008
        });
    }
}

// --- BUCLE DE RENDERIZADO OPTIMIZADO (60 FPS requestAnimationFrame) ---
function renderLoop() {
    requestAnimationFrame(renderLoop);

    witchPulse += 0.08;

    ctx.fillStyle = '#070b16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(0, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < canvas.width; x += gridSize * 2) {
        ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height);
    }
    for (let y = 0; y < canvas.height; y += gridSize * 2) {
        ctx.moveTo(0, y); ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();

    if (!latestState) return;

    const msgDiv = document.getElementById('msg');

    if (latestState.status === 'waiting') {
        msgDiv.innerText = "ESPERANDO AL RIVAL...";
        msgDiv.style.color = '#94a3b8';
    } else if (latestState.status === 'countdown') {
        msgDiv.innerText = "¡PREPÁRATE!";
        msgDiv.style.color = '#f1f5f9';
    } else if (latestState.status === 'gameover') {
        if (!latestState.p1.alive && !latestState.p2.alive) { 
            msgDiv.innerText = "¡EMPATE TÁCTICO! REVANCHA EN BREVE..."; 
            msgDiv.style.color = '#f1f5f9'; 
        } else if (!latestState.p1.alive) { 
            msgDiv.innerText = `¡VICTORIA PARA ${document.getElementById('nameP2').innerText}!`; 
            msgDiv.style.color = '#ff00ff'; 
        } else { 
            msgDiv.innerText = `¡VICTORIA PARA ${document.getElementById('nameP1').innerText}!`; 
            msgDiv.style.color = '#00ffff'; 
        }
    } else if (latestState.status === 'matchover') {
        msgDiv.innerText = "PARTIDA TERMINADA";
        msgDiv.style.color = '#ffd700';
    } else {
        msgDiv.innerText = "PARTIDA EN CURSO";
        msgDiv.style.color = '#00ffff';
    }

    // Dibujar Power-Ups (Bruja)
    if (latestState.powerUps && latestState.powerUps.length > 0) {
        const pulseAlpha = 0.45 + Math.sin(witchPulse) * 0.35;
        const pulseSize = 1 + Math.sin(witchPulse * 1.2) * 0.3;

        latestState.powerUps.forEach(pu => {
            const px = pu.x * gridSize + gridSize / 2;
            const py = pu.y * gridSize + gridSize / 2;

            // Aura pulsante morada
            const gradient = ctx.createRadialGradient(px, py, 0, px, py, gridSize * 2.5 * pulseSize);
            gradient.addColorStop(0, `rgba(191, 0, 255, ${pulseAlpha * 0.8})`);
            gradient.addColorStop(0.5, `rgba(140, 0, 200, ${pulseAlpha * 0.4})`);
            gradient.addColorStop(1, `rgba(80, 0, 140, 0)`);
            ctx.save();
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(px, py, gridSize * 2.5 * pulseSize, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // Icono bruja (emoji)
            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `${Math.floor(gridSize * 1.5 * pulseSize)}px sans-serif`;
            ctx.globalAlpha = 0.9;
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#bf00ff';
            ctx.fillText('🧙', px, py);
            ctx.restore();
        });
    }

    const drawPlayerOptimized = (p) => {
        if (!p || (!p.alive && p.trail.length === 0)) return;

        if (p.trail.length > 0) {
            ctx.save();
            ctx.strokeStyle = p.color;
            ctx.lineWidth = gridSize - 2;
            ctx.lineCap = 'square';
            ctx.lineJoin = 'miter';
            ctx.shadowBlur = 12;
            ctx.shadowColor = p.color;

            ctx.beginPath();
            let prev = p.trail[0];
            ctx.moveTo(prev.x * gridSize + gridSize / 2, prev.y * gridSize + gridSize / 2);

            for (let i = 1; i < p.trail.length; i++) {
                const pt = p.trail[i];
                const dx = Math.abs(pt.x - prev.x);
                const dy = Math.abs(pt.y - prev.y);

                if (dx > 1 || dy > 1) {
                    ctx.moveTo(pt.x * gridSize + gridSize / 2, pt.y * gridSize + gridSize / 2);
                } else {
                    ctx.lineTo(pt.x * gridSize + gridSize / 2, pt.y * gridSize + gridSize / 2);
                }
                prev = pt;
            }

            if (p.alive) {
                const dx = Math.abs(p.x - prev.x);
                const dy = Math.abs(p.y - prev.y);
                if (dx > 1 || dy > 1) {
                    ctx.moveTo(p.x * gridSize + gridSize / 2, p.y * gridSize + gridSize / 2);
                } else {
                    ctx.lineTo(p.x * gridSize + gridSize / 2, p.y * gridSize + gridSize / 2);
                }
            }
            ctx.stroke();
            ctx.restore();
        }

        if (p.alive) {
            ctx.save();
            ctx.fillStyle = '#ffffff';
            ctx.shadowBlur = 18;
            ctx.shadowColor = p.color;
            ctx.fillRect(p.x * gridSize, p.y * gridSize, gridSize - 1, gridSize - 1);
            ctx.restore();
        }
    };

    drawPlayerOptimized(latestState.p1);
    drawPlayerOptimized(latestState.p2);

    for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.alpha -= pt.decay;

        if (pt.alpha <= 0) {
            particles.splice(i, 1);
            continue;
        }

        ctx.save();
        ctx.globalAlpha = pt.alpha;
        ctx.fillStyle = pt.color;
        ctx.shadowBlur = 8;
        ctx.shadowColor = pt.color;
        ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
        ctx.restore();
    }

    for (let i = floatingReactions.length - 1; i >= 0; i--) {
        const r = floatingReactions[i];
        r.y += r.vy;
        r.alpha -= 0.012;
        if (r.scale < 1) r.scale += 0.05;

        if (r.alpha <= 0) {
            floatingReactions.splice(i, 1);
            continue;
        }

        ctx.save();
        ctx.globalAlpha = r.alpha;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        ctx.fillStyle = 'rgba(6, 9, 19, 0.85)';
        ctx.shadowBlur = 12;
        ctx.shadowColor = r.color;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 22 * r.scale, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = r.color;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = `${Math.floor(22 * r.scale)}px sans-serif`;
        ctx.fillText(r.emoji, r.x, r.y);
        ctx.restore();
    }

    if (latestState.status === 'countdown') {
        ctx.fillStyle = 'rgba(6, 9, 19, 0.75)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 110px "Orbitron", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowBlur = 30;
        ctx.shadowColor = '#00ffff';

        const text = latestState.countdownTime > 0 ? latestState.countdownTime : "¡YA!";
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        ctx.restore();
    }
}

requestAnimationFrame(renderLoop);

// --- CONTROL DE TECLADO Y MOVIMIENTO ---
let lastSentDir = '';

function sendMove(dir) {
    if (!currentRoomId || !latestState || latestState.status !== 'playing') return;
    if (lastSentDir === dir) return;

    lastSentDir = dir;
    audio.playTurn();
    socket.emit('move', dir);

    // Resetear lastSentDir después de un corto tiempo para permitir volver a la misma dirección si la trayectoria cambió
    setTimeout(() => {
        if (lastSentDir === dir) lastSentDir = '';
    }, 100);
}

document.addEventListener('keydown', e => {
    const active = document.activeElement;
    if (active === aliasInput || active === roomNameInput || active === roomCodeInput) return;

    const key = e.key.toLowerCase();
    if (key === 'w' || key === 'arrowup') sendMove('up');
    if (key === 's' || key === 'arrowdown') sendMove('down');
    if (key === 'a' || key === 'arrowleft') sendMove('left');
    if (key === 'd' || key === 'arrowright') sendMove('right');

    if (!isNaN(key) && parseInt(key) >= 1 && parseInt(key) <= 6) {
        const emojis = ['🔥', '😎', '💀', '⚡', '👑', '😂'];
        sendReaction(emojis[parseInt(key) - 1]);
    }
});

// Controles Táctiles D-Pad
const bindTouch = (id, dir) => {
    const btn = document.getElementById(id);
    btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        sendMove(dir);
    });
};
bindTouch('btnUp', 'up');
bindTouch('btnDown', 'down');
bindTouch('btnLeft', 'left');
bindTouch('btnRight', 'right');

// Gestos Swipe en Canvas
let touchStartX = 0;
let touchStartY = 0;

canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length > 0) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }
}, { passive: true });

canvas.addEventListener('touchend', (e) => {
    if (e.changedTouches.length === 0) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaY = e.changedTouches[0].clientY - touchStartY;
    const minSwipe = 25;

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
        if (Math.abs(deltaX) > minSwipe) {
            sendMove(deltaX > 0 ? 'right' : 'left');
        }
    } else {
        if (Math.abs(deltaY) > minSwipe) {
            sendMove(deltaY > 0 ? 'down' : 'up');
        }
    }
}, { passive: true });
