const gridSize = 10;
const width = 600 / gridSize;
const height = 600 / gridSize;

function setupTronGame(io) {
    const tronIo = io.of('/tron');
    const rooms = new Map();
    let powerUpIdCounter = 0;

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
            p1: { x: 10, y: Math.floor(height / 2), vx: 1, vy: 0, moveQueue: [], trail: [], alive: true, color: '#00ffff' },
            p2: { x: width - 10, y: Math.floor(height / 2), vx: -1, vy: 0, moveQueue: [], trail: [], alive: true, color: '#ff00ff' },
            status: 'waiting',
            countdownTime: 3,
            powerUps: []
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
                status: room.gameState.status,
                winsLimit: room.config.winsLimit
            });
        }
        return list;
    }

    function broadcastRoomsList() {
        tronIo.emit('roomsList', getRoomsList());
    }

    function getRandomEmptyPosition(room) {
        const gs = room.gameState;
        const occupied = new Set();

        for (const t of gs.p1.trail) occupied.add(`${t.x},${t.y}`);
        for (const t of gs.p2.trail) occupied.add(`${t.x},${t.y}`);
        occupied.add(`${gs.p1.x},${gs.p1.y}`);
        occupied.add(`${gs.p2.x},${gs.p2.y}`);
        for (const pu of gs.powerUps) occupied.add(`${pu.x},${pu.y}`);

        let tries = 0;
        while (tries < 200) {
            const x = Math.floor(Math.random() * (width - 4)) + 2;
            const y = Math.floor(Math.random() * (height - 4)) + 2;
            if (!occupied.has(`${x},${y}`)) {
                return { x, y };
            }
            tries++;
        }
        return null;
    }

    function spawnWitch(room) {
        if (room.gameState.status !== 'playing') return;

        const pos = getRandomEmptyPosition(room);
        if (!pos) return;

        const id = ++powerUpIdCounter;
        const witch = { id, x: pos.x, y: pos.y, type: 'witch' };
        room.gameState.powerUps.push(witch);

        tronIo.to(room.id).emit('state', room.gameState);

        const disappearTimeout = setTimeout(() => {
            if (!rooms.has(room.id)) return;
            const idx = room.gameState.powerUps.findIndex(p => p.id === id);
            if (idx !== -1) {
                room.gameState.powerUps.splice(idx, 1);
                tronIo.to(room.id).emit('state', room.gameState);
            }
            schedulePowerUp(room);
        }, 4000);

        room.witchDisappearTimeout = disappearTimeout;
    }

    function schedulePowerUp(room) {
        clearTimeout(room.witchSpawnTimeout);
        clearTimeout(room.witchDisappearTimeout);
        room.witchSpawnTimeout = setTimeout(() => {
            spawnWitch(room);
        }, 8000);
    }

    function checkPowerUpCollection(room) {
        const gs = room.gameState;
        if (gs.powerUps.length === 0) return;

        for (let i = gs.powerUps.length - 1; i >= 0; i--) {
            const pu = gs.powerUps[i];
            let collected = null;

            if (gs.p1.alive && gs.p1.x === pu.x && gs.p1.y === pu.y) collected = 'p1';
            else if (gs.p2.alive && gs.p2.x === pu.x && gs.p2.y === pu.y) collected = 'p2';

            if (collected) {
                gs.powerUps.splice(i, 1);
                room.gameData.lives[collected]++;
                tronIo.to(room.id).emit('witchCollected', { by: collected, lives: room.gameData.lives });
                tronIo.to(room.id).emit('updateData', room.gameData);

                clearTimeout(room.witchDisappearTimeout);
                schedulePowerUp(room);
            }
        }
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

        if (p1Hit) gs.p1.alive = false;
        if (p2Hit) gs.p2.alive = false;

        if (gs.p1.x === gs.p2.x && gs.p1.y === gs.p2.y) {
            gs.p1.alive = false;
            gs.p2.alive = false;
        }
    }

    function startRoomCountdown(room) {
        if (room.gameState.status === 'countdown' || room.gameState.status === 'playing') return;

        clearTimeout(room.witchSpawnTimeout);
        clearTimeout(room.witchDisappearTimeout);
        room.gameState.powerUps = [];

        room.gameState.status = 'countdown';
        room.gameState.countdownTime = 3;
        tronIo.to(room.id).emit('state', room.gameState);

        clearInterval(room.countdownInterval);
        room.countdownInterval = setInterval(() => {
            room.gameState.countdownTime--;

            if (room.gameState.countdownTime < 0) {
                clearInterval(room.countdownInterval);
                room.gameState.status = 'playing';
                startRoomGameLoop(room);
                schedulePowerUp(room);
            } else {
                tronIo.to(room.id).emit('state', room.gameState);
            }
        }, 1000);
    }

    function startRoomGameLoop(room) {
        clearInterval(room.gameLoop);
        room.gameLoop = setInterval(() => {
            if (room.gameState.status !== 'playing') return;

            if (room.gameState.p1.alive) {
                if (room.gameState.p1.moveQueue && room.gameState.p1.moveQueue.length > 0) {
                    const nextMove = room.gameState.p1.moveQueue.shift();
                    room.gameState.p1.vx = nextMove.vx;
                    room.gameState.p1.vy = nextMove.vy;
                }
                room.gameState.p1.trail.push({ x: room.gameState.p1.x, y: room.gameState.p1.y });
                room.gameState.p1.x = (room.gameState.p1.x + room.gameState.p1.vx + width) % width;
                room.gameState.p1.y = (room.gameState.p1.y + room.gameState.p1.vy + height) % height;
            }
            if (room.gameState.p2.alive) {
                if (room.gameState.p2.moveQueue && room.gameState.p2.moveQueue.length > 0) {
                    const nextMove = room.gameState.p2.moveQueue.shift();
                    room.gameState.p2.vx = nextMove.vx;
                    room.gameState.p2.vy = nextMove.vy;
                }
                room.gameState.p2.trail.push({ x: room.gameState.p2.x, y: room.gameState.p2.y });
                room.gameState.p2.x = (room.gameState.p2.x + room.gameState.p2.vx + width) % width;
                room.gameState.p2.y = (room.gameState.p2.y + room.gameState.p2.vy + height) % height;
            }

            checkPowerUpCollection(room);
            checkRoomCollisions(room);
            tronIo.to(room.id).emit('state', room.gameState);

            if (!room.gameState.p1.alive || !room.gameState.p2.alive) {
                room.gameState.status = 'gameover';
                clearInterval(room.gameLoop);
                clearTimeout(room.witchSpawnTimeout);
                clearTimeout(room.witchDisappearTimeout);

                let roundWinner = null;
                if (room.gameState.p1.alive && !room.gameState.p2.alive) {
                    room.gameData.scores.p1++;
                    room.gameData.lives.p2 = Math.max(0, room.gameData.lives.p2 - 1);
                    roundWinner = 'p1';
                } else if (!room.gameState.p1.alive && room.gameState.p2.alive) {
                    room.gameData.scores.p2++;
                    room.gameData.lives.p1 = Math.max(0, room.gameData.lives.p1 - 1);
                    roundWinner = 'p2';
                } else {
                    room.gameData.lives.p1 = Math.max(0, room.gameData.lives.p1 - 1);
                    room.gameData.lives.p2 = Math.max(0, room.gameData.lives.p2 - 1);
                    roundWinner = 'draw';
                }

                tronIo.to(room.id).emit('updateData', room.gameData);
                tronIo.to(room.id).emit('state', room.gameState);

                const wl = room.config.winsLimit;
                const p1MatchWin = room.gameData.scores.p1 >= wl;
                const p2MatchWin = room.gameData.scores.p2 >= wl;
                const p1NoLives = room.gameData.lives.p1 <= 0;
                const p2NoLives = room.gameData.lives.p2 <= 0;

                if (p1MatchWin || p2MatchWin || p1NoLives || p2NoLives) {
                    let matchWinner = 'draw';
                    let reason = 'winsLimit';
                    if (p1MatchWin && !p2MatchWin) matchWinner = 'p1';
                    else if (p2MatchWin && !p1MatchWin) matchWinner = 'p2';
                    else if (p2NoLives && !p1NoLives) { matchWinner = 'p1'; reason = 'lives'; }
                    else if (p1NoLives && !p2NoLives) { matchWinner = 'p2'; reason = 'lives'; }

                    room.gameState.status = 'matchover';
                    const winnerName = matchWinner === 'p1' ? room.gameData.names.p1
                        : (matchWinner === 'p2' ? room.gameData.names.p2 : 'EMPATE');

                    setTimeout(() => {
                        if (rooms.has(room.id)) {
                            tronIo.to(room.id).emit('matchWin', {
                                winner: matchWinner,
                                winnerName,
                                reason,
                                scores: room.gameData.scores,
                                lives: room.gameData.lives,
                                winsLimit: wl
                            });
                            tronIo.to(room.id).emit('state', room.gameState);
                        }
                    }, 1800);
                } else {
                    setTimeout(() => {
                        if (rooms.has(room.id)) {
                            room.gameState = createGameState();
                            startRoomCountdown(room);
                        }
                    }, 3000);
                }
            }
        }, 48);
    }

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

            if (socket.role === 'p1' || socket.role === 'p2') {
                clearInterval(room.gameLoop);
                clearInterval(room.countdownInterval);
                clearTimeout(room.witchSpawnTimeout);
                clearTimeout(room.witchDisappearTimeout);
                room.gameState = createGameState();
                tronIo.to(roomId).emit('updateData', room.gameData);
                tronIo.to(roomId).emit('state', room.gameState);
            }

            const remainingClients = (room.players.p1 ? 1 : 0) + (room.players.p2 ? 1 : 0) + room.spectators.size;
            if (remainingClients === 0) {
                clearInterval(room.gameLoop);
                clearInterval(room.countdownInterval);
                clearTimeout(room.witchSpawnTimeout);
                clearTimeout(room.witchDisappearTimeout);
                rooms.delete(roomId);
            }
        }

        socket.role = null;
        broadcastRoomsList();
    }

    tronIo.on('connection', (socket) => {
        socket.currentRoomId = null;
        socket.role = null;

        socket.emit('roomsList', getRoomsList());

        socket.on('pingCheck', (callback) => {
            if (typeof callback === 'function') callback();
        });

        socket.on('getRooms', () => {
            socket.emit('roomsList', getRoomsList());
        });

        socket.on('createRoom', ({ roomName, alias, winsLimit }, callback) => {
            leaveCurrentRoom(socket);

            let roomId = generateRoomId();
            while (rooms.has(roomId)) {
                roomId = generateRoomId();
            }

            const finalAlias = alias || 'Cyan';
            const finalRoomName = roomName || `Sala de ${finalAlias}`;
            const finalWinsLimit = Math.max(1, Math.min(20, parseInt(winsLimit) || 3));

            const newRoom = {
                id: roomId,
                name: finalRoomName,
                players: { p1: socket.id, p2: null },
                spectators: new Set(),
                config: { winsLimit: finalWinsLimit },
                gameData: {
                    names: { p1: finalAlias, p2: 'Esperando...' },
                    ready: { p1: true, p2: false },
                    scores: { p1: 0, p2: 0 },
                    lives: { p1: finalWinsLimit, p2: finalWinsLimit }
                },
                gameState: createGameState(),
                gameLoop: null,
                countdownInterval: null,
                witchSpawnTimeout: null,
                witchDisappearTimeout: null
            };

            rooms.set(roomId, newRoom);
            socket.join(roomId);
            socket.currentRoomId = roomId;
            socket.role = 'p1';

            if (typeof callback === 'function') {
                callback({ success: true, roomId, role: 'p1', roomName: finalRoomName, gameData: newRoom.gameData, gameState: newRoom.gameState, config: newRoom.config });
            }

            tronIo.to(roomId).emit('updateData', newRoom.gameData);
            tronIo.to(roomId).emit('roomConfig', newRoom.config);
            tronIo.to(roomId).emit('state', newRoom.gameState);
            broadcastRoomsList();
        });

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

            if (typeof callback === 'function') {
                callback({ success: true, roomId: targetId, role, roomName: room.name, gameData: room.gameData, gameState: room.gameState, config: room.config });
            }

            tronIo.to(targetId).emit('updateData', room.gameData);
            tronIo.to(targetId).emit('roomConfig', room.config);
            tronIo.to(targetId).emit('state', room.gameState);

            if (room.gameData.ready.p1 && room.gameData.ready.p2 && room.gameState.status === 'waiting') {
                startRoomCountdown(room);
            }

            broadcastRoomsList();
        });

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

            let targetVx = 0, targetVy = 0;
            if (dir === 'up') { targetVx = 0; targetVy = -1; }
            else if (dir === 'down') { targetVx = 0; targetVy = 1; }
            else if (dir === 'left') { targetVx = -1; targetVy = 0; }
            else if (dir === 'right') { targetVx = 1; targetVy = 0; }
            else return;

            if (!p.moveQueue) p.moveQueue = [];

            const lastMove = p.moveQueue.length > 0 
                ? p.moveQueue[p.moveQueue.length - 1] 
                : { vx: p.vx, vy: p.vy };

            const isOpposite = (targetVx === -lastMove.vx && targetVy === -lastMove.vy);
            const isSame = (targetVx === lastMove.vx && targetVy === lastMove.vy);

            if (!isOpposite && !isSame && p.moveQueue.length < 2) {
                p.moveQueue.push({ vx: targetVx, vy: targetVy });
            }
        });

        socket.on('reaction', (emoji) => {
            if (!socket.currentRoomId) return;
            if (typeof emoji === 'string' && emoji.length <= 8) {
                tronIo.to(socket.currentRoomId).emit('reaction', { role: socket.role, emoji });
            }
        });

        socket.on('rematch', () => {
            if (!socket.currentRoomId) return;
            const room = rooms.get(socket.currentRoomId);
            if (!room || room.gameState.status !== 'matchover') return;
            if (socket.role !== 'p1' && socket.role !== 'p2') return;

            room.gameData.scores = { p1: 0, p2: 0 };
            room.gameData.lives = { p1: room.config.winsLimit, p2: room.config.winsLimit };
            room.gameState = createGameState();

            tronIo.to(room.id).emit('updateData', room.gameData);
            tronIo.to(room.id).emit('state', room.gameState);
            tronIo.to(room.id).emit('rematchStarted', { config: room.config });
            startRoomCountdown(room);
        });

        socket.on('disconnect', () => {
            leaveCurrentRoom(socket);
        });
    });

    return {
        getStats: () => {
            let totalPlayers = 0;
            for (const room of rooms.values()) {
                if (room.players.p1) totalPlayers++;
                if (room.players.p2) totalPlayers++;
            }
            return { activeRooms: rooms.size, totalPlayers };
        }
    };
}

module.exports = setupTronGame;
