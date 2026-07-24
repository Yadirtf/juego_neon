const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const gridSize = 10;
const width = 600 / gridSize;
const height = 600 / gridSize;

// Variables globales para la sala
let players = { p1: null, p2: null };
let gameData = {
    names: { p1: 'Esperando...', p2: 'Esperando...' },
    ready: { p1: false, p2: false },
    scores: { p1: 0, p2: 0 }
};

let gameState = resetGame();
let gameLoop;
let countdownInterval;

function resetGame() {
    return {
        p1: { x: 10, y: height / 2, vx: 1, vy: 0, trail: [], alive: true, color: '#00ffff' },
        p2: { x: width - 10, y: height / 2, vx: -1, vy: 0, trail: [], alive: true, color: '#ff00ff' },
        status: 'waiting',
        countdownTime: 3
    };
}

io.on('connection', (socket) => {
    let role = 'spectator';
    if (!players.p1) { players.p1 = socket.id; role = 'p1'; }
    else if (!players.p2) { players.p2 = socket.id; role = 'p2'; }

    console.log(`[+] Jugador conectado: ${role} (ID: ${socket.id})`);

    // Enviar datos iniciales
    socket.emit('init', { role, gameData });
    io.emit('updateData', gameData);
    socket.emit('state', gameState);

    // Cuando el jugador da clic en "Entrar a la Sala"
    socket.on('setAlias', (alias) => {
        const finalAlias = alias || (role === 'p1' ? 'Cyan' : 'Magenta');
        console.log(`[>] ${role} está listo con el alias: ${finalAlias}`);

        if (role === 'p1') { gameData.names.p1 = finalAlias; gameData.ready.p1 = true; }
        if (role === 'p2') { gameData.names.p2 = finalAlias; gameData.ready.p2 = true; }

        io.emit('updateData', gameData);

        // Si ambos están listos, arranca el conteo
        if (gameData.ready.p1 && gameData.ready.p2 && gameState.status === 'waiting') {
            startCountdown();
        }
    });

    socket.on('move', (dir) => {
        if (gameState.status !== 'playing') return;
        let p = role === 'p1' ? gameState.p1 : (role === 'p2' ? gameState.p2 : null);
        if (!p) return;

        if (dir === 'up' && p.vy === 0) { p.vx = 0; p.vy = -1; }
        if (dir === 'down' && p.vy === 0) { p.vx = 0; p.vy = 1; }
        if (dir === 'left' && p.vx === 0) { p.vx = -1; p.vy = 0; }
        if (dir === 'right' && p.vx === 0) { p.vx = 1; p.vy = 0; }
    });

    socket.on('disconnect', () => {
        console.log(`[-] Jugador desconectado: ${role}`);
        if (role === 'p1') { players.p1 = null; gameData.names.p1 = 'Esperando...'; gameData.ready.p1 = false; gameData.scores.p1 = 0; }
        if (role === 'p2') { players.p2 = null; gameData.names.p2 = 'Esperando...'; gameData.ready.p2 = false; gameData.scores.p2 = 0; }

        clearInterval(gameLoop);
        clearInterval(countdownInterval);
        gameState = resetGame();
        io.emit('updateData', gameData);
        io.emit('state', gameState);
    });
});

function startCountdown() {
    if (gameState.status === 'countdown' || gameState.status === 'playing') return;

    console.log(`[!] Iniciando cuenta regresiva...`);
    gameState.status = 'countdown';
    gameState.countdownTime = 3;
    io.emit('state', gameState);

    clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        gameState.countdownTime--;

        if (gameState.countdownTime < 0) {
            clearInterval(countdownInterval);
            gameState.status = 'playing';
            console.log(`[!] ¡Partida iniciada!`);
            startGameLoop();
        } else {
            io.emit('state', gameState);
        }
    }, 1000);
}

function startGameLoop() {
    clearInterval(gameLoop);
    gameLoop = setInterval(() => {
        if (gameState.status !== 'playing') return;

        if (gameState.p1.alive) {
            gameState.p1.trail.push({ x: gameState.p1.x, y: gameState.p1.y });
            gameState.p1.x += gameState.p1.vx;
            gameState.p1.y += gameState.p1.vy;
        }
        if (gameState.p2.alive) {
            gameState.p2.trail.push({ x: gameState.p2.x, y: gameState.p2.y });
            gameState.p2.x += gameState.p2.vx;
            gameState.p2.y += gameState.p2.vy;
        }

        checkCollisions();
        io.emit('state', gameState);

        // Validar quién ganó o si hubo empate
        if (!gameState.p1.alive || !gameState.p2.alive) {
            gameState.status = 'gameover';
            clearInterval(gameLoop);

            let winner = 'Empate';
            if (gameState.p1.alive && !gameState.p2.alive) { gameData.scores.p1++; winner = 'p1'; }
            else if (!gameState.p1.alive && gameState.p2.alive) { gameData.scores.p2++; winner = 'p2'; }

            console.log(`[!] Fin de ronda. Ganador: ${winner}. Marcador: ${gameData.scores.p1} - ${gameData.scores.p2}`);

            io.emit('updateData', gameData); // Actualiza la pantalla de puntajes

            // Reinicio automático
            setTimeout(() => {
                gameState = resetGame();
                startCountdown();
            }, 3000);
        }
    }, 60);
}

function checkCollisions() {
    const hitTrail = (x, y) => gameState.p1.trail.some(t => t.x === x && t.y === y) || gameState.p2.trail.some(t => t.x === x && t.y === y);

    if (gameState.p1.x < 0 || gameState.p1.x >= width || gameState.p1.y < 0 || gameState.p1.y >= height) gameState.p1.alive = false;
    if (gameState.p2.x < 0 || gameState.p2.x >= width || gameState.p2.y < 0 || gameState.p2.y >= height) gameState.p2.alive = false;

    if (hitTrail(gameState.p1.x, gameState.p1.y)) gameState.p1.alive = false;
    if (hitTrail(gameState.p2.x, gameState.p2.y)) gameState.p2.alive = false;

    if (gameState.p1.x === gameState.p2.x && gameState.p1.y === gameState.p2.y) {
        gameState.p1.alive = false;
        gameState.p2.alive = false;
    }
}

server.listen(3000, '0.0.0.0', () => {
    console.log('==============================================');
    console.log('🚀 SERVIDOR MULTIJUGADOR INICIADO CORRECTAMENTE');
    console.log('==============================================');
});