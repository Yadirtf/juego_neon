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

// Almacenamiento dinámico de salas (Multi-Sala)
const rooms = new Map();

function generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'NEON-';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function createGameState() {
    return {
        p1: { x: 10, y: Math.floor(height / 2), vx: 1, vy: 0, nextVx: 1, nextVy: 0, trail: [], alive: true, color: '#00ffff' },
        p2: { x: width - 10, y: Math.floor(height / 2), vx: -1, vy: 0, nextVx: -1, nextVy: 0, trail: [], alive: true, color: '#ff00ff' },
        status: 'waiting',
        countdownTime: 3
    };
}

function getRoomsList() {
    const list = [];
    for (const [id, room] of rooms.entries()) {
        const playerCount = (room.players.p1 ? 1 : 0) + (room.players.p2 ? 1 : 0);
        const spectatorCount = room.spectators.size;
        
        list.push({
            id: id,
            name: room.name,
            p1Name: room.gameData.names.p1,
            p2Name: room.gameData.names.p2,
            playerCount: playerCount,
            spectatorCount: spectatorCount,
            status: room.gameState.status
        });
    }
    return list;
}

function broadcastRoomsList() {
    io.emit('roomsList', getRoomsList());
}

io.on('connection', (socket) => {
    socket.currentRoomId = null;
    socket.role = null;

    // Enviar lista inicial de salas públicas
    socket.emit('roomsList', getRoomsList());

    socket.on('pingCheck', (callback) => {
        if (typeof callback === 'function') callback();
    });

    socket.on('getRooms', () => {
        socket.emit('roomsList', getRoomsList());
    });

    // Crear una nueva sala
    socket.on('createRoom', ({ roomName, alias }, callback) => {
        leaveCurrentRoom(socket);

        let roomId = generateRoomId();
        while (rooms.has(roomId)) {
            roomId = generateRoomId();
        }

        const finalAlias = alias || 'Cyan';
        const finalRoomName = roomName || `Sala de ${finalAlias}`;

        const newRoom = {
            id: roomId,
            name: finalRoomName,
            players: { p1: socket.id, p2: null },
            spectators: new Set(),
            gameData: {
                names: { p1: finalAlias, p2: 'Esperando...' },
                ready: { p1: true, p2: false },
                scores: { p1: 0, p2: 0 }
            },
            gameState: createGameState(),
            gameLoop: null,
            countdownInterval: null
        };

        rooms.set(roomId, newRoom);
        socket.join(roomId);
        socket.currentRoomId = roomId;
        socket.role = 'p1';

        console.log(`[+] Sala creada: ${roomId} (${finalRoomName}) por ${finalAlias} (ID: ${socket.id})`);

        if (typeof callback === 'function') {
            callback({ success: true, roomId, role: 'p1', roomName: finalRoomName, gameData: newRoom.gameData, gameState: newRoom.gameState });
        }

        io.to(roomId).emit('updateData', newRoom.gameData);
        io.to(roomId).emit('state', newRoom.gameState);
        broadcastRoomsList();
    });

    // Unirse a una sala existente
    socket.on('joinRoom', ({ roomId, alias }, callback) => {
        leaveCurrentRoom(socket);

        const targetId = (roomId || '').trim().toUpperCase();
        const room = rooms.get(targetId);

        if (!room) {
            if (typeof callback === 'function') callback({ success: false, error: 'La sala especificada no existe o fue cerrada.' });
            return;
        }

        let role = 'spectator';
        const finalAlias = alias || 'Jugador';

        if (!room.players.p1) {
            room.players.p1 = socket.id;
            role = 'p1';
            room.gameData.names.p1 = finalAlias;
            room.gameData.ready.p1 = true;
        } else if (!room.players.p2) {
            room.players.p2 = socket.id;
            role = 'p2';
            room.gameData.names.p2 = finalAlias;
            room.gameData.ready.p2 = true;
        } else {
            role = 'spectator';
            room.spectators.add(socket.id);
        }

        socket.join(targetId);
        socket.currentRoomId = targetId;
        socket.role = role;

        console.log(`[+] Socket ${socket.id} se unió a ${targetId} como ${role}`);

        if (typeof callback === 'function') {
            callback({ success: true, roomId: targetId, role, roomName: room.name, gameData: room.gameData, gameState: room.gameState });
        }

        io.to(targetId).emit('updateData', room.gameData);
        io.to(targetId).emit('state', room.gameState);

        // Si ambos jugadores están listos y la sala está esperando, iniciar conteo
        if (room.gameData.ready.p1 && room.gameData.ready.p2 && room.gameState.status === 'waiting') {
            startRoomCountdown(room);
        }

        broadcastRoomsList();
    });

    // Salir de la sala actual
    socket.on('leaveRoom', () => {
        leaveCurrentRoom(socket);
        socket.emit('leftRoom');
    });

    socket.on('move', (dir) => {
        if (!socket.currentRoomId) return;
        const room = rooms.get(socket.currentRoomId);
        if (!room || room.gameState.status !== 'playing') return;

        let p = socket.role === 'p1' ? room.gameState.p1 : (socket.role === 'p2' ? room.gameState.p2 : null);
        if (!p || !p.alive) return;

        if (dir === 'up' && p.vy === 0 && p.nextVy === 0) { p.nextVx = 0; p.nextVy = -1; }
        if (dir === 'down' && p.vy === 0 && p.nextVy === 0) { p.nextVx = 0; p.nextVy = 1; }
        if (dir === 'left' && p.vx === 0 && p.nextVx === 0) { p.nextVx = -1; p.nextVy = 0; }
        if (dir === 'right' && p.vx === 0 && p.nextVx === 0) { p.nextVx = 1; p.nextVy = 0; }
    });

    socket.on('reaction', (emoji) => {
        if (!socket.currentRoomId) return;
        if (typeof emoji === 'string' && emoji.length <= 8) {
            io.to(socket.currentRoomId).emit('reaction', { role: socket.role, emoji });
        }
    });

    socket.on('disconnect', () => {
        leaveCurrentRoom(socket);
    });
});

function leaveCurrentRoom(socket) {
    const roomId = socket.currentRoomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    socket.leave(roomId);
    socket.currentRoomId = null;

    if (room) {
        if (socket.role === 'p1') {
            room.players.p1 = null;
            room.gameData.names.p1 = 'Esperando...';
            room.gameData.ready.p1 = false;
        } else if (socket.role === 'p2') {
            room.players.p2 = null;
            room.gameData.names.p2 = 'Esperando...';
            room.gameData.ready.p2 = false;
        } else {
            room.spectators.delete(socket.id);
        }

        // Si se salió un jugador en duelo o cuenta regresiva, reiniciar el juego
        if (socket.role === 'p1' || socket.role === 'p2') {
            clearInterval(room.gameLoop);
            clearInterval(room.countdownInterval);
            room.gameState = createGameState();
            io.to(roomId).emit('updateData', room.gameData);
            io.to(roomId).emit('state', room.gameState);
        }

        // Si la sala queda completamente vacía (0 jugadores y 0 espectadores), destruirla
        const remainingClients = (room.players.p1 ? 1 : 0) + (room.players.p2 ? 1 : 0) + room.spectators.size;
        if (remainingClients === 0) {
            clearInterval(room.gameLoop);
            clearInterval(room.countdownInterval);
            rooms.delete(roomId);
            console.log(`[-] Sala ${roomId} eliminada por estar vacía.`);
        }
    }

    socket.role = null;
    broadcastRoomsList();
}

function startRoomCountdown(room) {
    if (room.gameState.status === 'countdown' || room.gameState.status === 'playing') return;

    console.log(`[!] Iniciando cuenta regresiva en sala ${room.id}...`);
    room.gameState.status = 'countdown';
    room.gameState.countdownTime = 3;
    io.to(room.id).emit('state', room.gameState);

    clearInterval(room.countdownInterval);
    room.countdownInterval = setInterval(() => {
        room.gameState.countdownTime--;

        if (room.gameState.countdownTime < 0) {
            clearInterval(room.countdownInterval);
            room.gameState.status = 'playing';
            console.log(`[!] ¡Partida iniciada en sala ${room.id}!`);
            startRoomGameLoop(room);
        } else {
            io.to(room.id).emit('state', room.gameState);
        }
    }, 1000);
}

function startRoomGameLoop(room) {
    clearInterval(room.gameLoop);
    room.gameLoop = setInterval(() => {
        if (room.gameState.status !== 'playing') return;

        if (room.gameState.p1.alive) {
            room.gameState.p1.vx = room.gameState.p1.nextVx;
            room.gameState.p1.vy = room.gameState.p1.nextVy;
            room.gameState.p1.trail.push({ x: room.gameState.p1.x, y: room.gameState.p1.y });
            room.gameState.p1.x = (room.gameState.p1.x + room.gameState.p1.vx + width) % width;
            room.gameState.p1.y = (room.gameState.p1.y + room.gameState.p1.vy + height) % height;
        }
        if (room.gameState.p2.alive) {
            room.gameState.p2.vx = room.gameState.p2.nextVx;
            room.gameState.p2.vy = room.gameState.p2.nextVy;
            room.gameState.p2.trail.push({ x: room.gameState.p2.x, y: room.gameState.p2.y });
            room.gameState.p2.x = (room.gameState.p2.x + room.gameState.p2.vx + width) % width;
            room.gameState.p2.y = (room.gameState.p2.y + room.gameState.p2.vy + height) % height;
        }

        checkRoomCollisions(room);
        io.to(room.id).emit('state', room.gameState);

        if (!room.gameState.p1.alive || !room.gameState.p2.alive) {
            room.gameState.status = 'gameover';
            clearInterval(room.gameLoop);

            let winner = 'Empate';
            if (room.gameState.p1.alive && !room.gameState.p2.alive) { room.gameData.scores.p1++; winner = 'p1'; }
            else if (!room.gameState.p1.alive && room.gameState.p2.alive) { room.gameData.scores.p2++; winner = 'p2'; }

            console.log(`[!] Fin de ronda en sala ${room.id}. Ganador: ${winner}. Marcador: ${room.gameData.scores.p1} - ${room.gameData.scores.p2}`);

            io.to(room.id).emit('updateData', room.gameData);
            io.to(room.id).emit('state', room.gameState);

            setTimeout(() => {
                if (rooms.has(room.id)) {
                    room.gameState = createGameState();
                    startRoomCountdown(room);
                }
            }, 3000);
        }
    }, 60);
}

function checkRoomCollisions(room) {
    const trailSet = new Set();
    const gs = room.gameState;

    if (gs.p1 && gs.p1.trail) {
        for (let i = 0; i < gs.p1.trail.length; i++) {
            const t = gs.p1.trail[i];
            trailSet.add(`${t.x},${t.y}`);
        }
    }
    if (gs.p2 && gs.p2.trail) {
        for (let i = 0; i < gs.p2.trail.length; i++) {
            const t = gs.p2.trail[i];
            trailSet.add(`${t.x},${t.y}`);
        }
    }

    const p1Hit = trailSet.has(`${gs.p1.x},${gs.p1.y}`);
    const p2Hit = trailSet.has(`${gs.p2.x},${gs.p2.y}`);

    if (p1Hit) {
        gs.p1.alive = false;
    }
    if (p2Hit) {
        gs.p2.alive = false;
    }

    if (gs.p1.x === gs.p2.x && gs.p1.y === gs.p2.y) {
        gs.p1.alive = false;
        gs.p2.alive = false;
    }
}

server.listen(3000, '0.0.0.0', () => {
    console.log('==============================================');
    console.log('🚀 SERVIDOR MULTI-SALA INICIADO CORRECTAMENTE');
    console.log('==============================================');
});