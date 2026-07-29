const WORLD_SIZE = 3000;
const MAX_PLAYERS_PER_ROOM = 25;
const INITIAL_PELLETS = 400;
const BOT_NAMES = ['CyberViper', 'NeonCobalt', 'ByteCobra', 'QuantumSnake', 'PulsePython', 'GlitchHydra', 'HyperAnacondo', 'ZeroViper', 'PixelBoa', 'SyntaxApex'];
const NEON_COLORS = ['#00ffff', '#ff00ff', '#39ff14', '#ffd700', '#ff0055', '#bf00ff', '#00ffaa', '#ffaa00'];

function setupSlitherGame(io) {
    const slitherIo = io.of('/slither');
    const rooms = new Map();
    let roomIdCounter = 0;
    let pelletIdCounter = 0;

    function getRandomColor() {
        return NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)];
    }

    function createPellet(x, y, value = 8) {
        return {
            id: ++pelletIdCounter,
            x: x !== undefined ? x : Math.floor(Math.random() * (WORLD_SIZE - 100)) + 50,
            y: y !== undefined ? y : Math.floor(Math.random() * (WORLD_SIZE - 100)) + 50,
            radius: Math.min(16, 4 + value * 0.5),
            value: value,
            color: getRandomColor()
        };
    }

    function createSnake(id, name, isBot = false) {
        const x = Math.floor(Math.random() * (WORLD_SIZE - 400)) + 200;
        const y = Math.floor(Math.random() * (WORLD_SIZE - 400)) + 200;
        const angle = Math.random() * Math.PI * 2;
        const initialLength = 10;
        const body = [];
        const history = [];
        
        for (let i = 0; i < initialLength; i++) {
            const pt = {
                x: x - Math.cos(angle) * i * 6,
                y: y - Math.sin(angle) * i * 6
            };
            body.push(pt);
            history.push({ x: pt.x, y: pt.y });
        }

        return {
            id,
            name: name || (isBot ? 'NeonBot' : 'Jugador'),
            isBot,
            x,
            y,
            angle,
            targetAngle: angle,
            angularVelocity: 0,  // inercia de giro (momentum angular)
            speed: 4.8,
            boosting: false,
            score: 100,
            length: initialLength,
            color: getRandomColor(),
            body,
            history,
            alive: true,
            botTimer: 0
        };
    }

    function createArenaRoom(mode = 'multiplayer', name = 'Arena Neón') {
        const id = `SLITHER-${++roomIdCounter}`;
        const room = {
            id,
            name,
            mode,
            players: new Map(), // socketId -> snake
            bots: new Map(),    // botId -> snake
            pellets: new Map(), // pelletId -> pellet
            gameLoop: null
        };

        // Pre-poblar pellets
        for (let i = 0; i < INITIAL_PELLETS; i++) {
            const p = createPellet();
            room.pellets.set(p.id, p);
        }

        // Si es solo mode, añadir 12 bots desde el inicio
        if (mode === 'solo') {
            for (let i = 0; i < 12; i++) {
                const botName = BOT_NAMES[i % BOT_NAMES.length];
                const botId = `bot_${Date.now()}_${i}`;
                room.bots.set(botId, createSnake(botId, botName, true));
            }
        }

        startArenaLoop(room);
        rooms.set(id, room);
        return room;
    }

    function spawnDeathPellets(room, snake) {
        if (!snake.body || snake.body.length === 0) return;

        // Distribución justa de puntos: el 80% del score de la serpiente muerta se convierte en comida
        const totalDeathScore = Math.floor(snake.score * 0.8);
        
        // Dejamos caer un orbe aproximadamente cada 1.5 segmentos para que queden abundantes pero juntos
        const numPellets = Math.max(6, Math.floor(snake.body.length / 1.5));
        const valuePerPellet = Math.max(2, Math.floor(totalDeathScore / numPellets));

        for (let i = 0; i < numPellets; i++) {
            // Distribuir a lo largo de los segmentos del cuerpo
            const bodyIdx = Math.floor((i / numPellets) * snake.body.length);
            const pt = snake.body[bodyIdx] || snake.body[snake.body.length - 1];

            // Dispersión desorganizada pero compacta (dentro de un radio de 25px)
            const dispAngle = Math.random() * Math.PI * 2;
            const dispDist = Math.random() * 25;
            const px = pt.x + Math.cos(dispAngle) * dispDist;
            const py = pt.y + Math.sin(dispAngle) * dispDist;

            const p = createPellet(px, py, valuePerPellet);
            // Los restos toman el color neón de la serpiente muerta (como en el original)
            p.color = snake.color;
            room.pellets.set(p.id, p);
        }
    }

    function updateBotAI(room, bot) {
        bot.botTimer++;
        
        const MIN_SCORE = 100;

        // 1. Detección de peligro (evitar colisiones con cuerpos de otras serpientes y paredes)
        let dangerDetected = false;
        let avoidAngle = 0;
        
        // Distancia de detección de peligro
        const SENSING_DIST = 120;
        const allSnakes = [...room.players.values(), ...room.bots.values()];
        
        for (const other of allSnakes) {
            if (!other.alive) continue;
            
            // Si es él mismo, ignorar sus primeros segmentos para no auto-evadirse erráticamente, pero evitar su cola lejana
            const startIdx = (other.id === bot.id) ? 12 : 0;
            
            for (let i = startIdx; i < other.body.length; i += 2) {
                const seg = other.body[i];
                const d = Math.hypot(seg.x - bot.x, seg.y - bot.y);
                
                if (d < SENSING_DIST) {
                    // Hay un segmento cerca al frente. Calculamos el ángulo relativo
                    const angleToSeg = Math.atan2(seg.y - bot.y, seg.x - bot.x);
                    let angleDiff = angleToSeg - bot.angle;
                    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                    
                    // Si está al frente (dentro de un cono de 120 grados)
                    if (Math.abs(angleDiff) < Math.PI / 3) {
                        dangerDetected = true;
                        // Girar al lado opuesto del peligro
                        avoidAngle = bot.angle - Math.sign(angleDiff) * (Math.PI / 2);
                        break;
                    }
                }
            }
            if (dangerDetected) break;
        }

        // Evitar paredes de la arena con advertencia de 200px
        const WALL_WARN = 200;
        if (bot.x < WALL_WARN || bot.x > WORLD_SIZE - WALL_WARN || bot.y < WALL_WARN || bot.y > WORLD_SIZE - WALL_WARN) {
            dangerDetected = true;
            if (bot.x < WALL_WARN) avoidAngle = 0; // Girar a la derecha
            else if (bot.x > WORLD_SIZE - WALL_WARN) avoidAngle = Math.PI; // Girar a la izquierda
            else if (bot.y < WALL_WARN) avoidAngle = Math.PI / 2; // Girar hacia abajo
            else if (bot.y > WORLD_SIZE - WALL_WARN) avoidAngle = -Math.PI / 2; // Girar hacia arriba
        }

        if (dangerDetected) {
            bot.targetAngle = avoidAngle;
            // Ocasionalmente acelerar para escapar del peligro
            if (Math.random() < 0.05 && bot.score > 150) {
                bot.boosting = true;
            }
            return;
        }

        // 2. Mecánica de ataque / Interposición (Cut-Off de nivel bajo contra el jugador)
        let attacking = false;
        // Solo bots con suficiente score (para tener cuerpo largo) y con probabilidad del 25% (bots cuyo ID termina en múltiplo de 4)
        const botIdNumber = parseInt(bot.id.split('_').pop()) || 0;
        const shouldAttack = bot.score > 200 && (botIdNumber % 4 === 0);
        
        if (shouldAttack) {
            for (const player of room.players.values()) {
                if (!player.alive) continue;
                
                const distToPlayer = Math.hypot(player.x - bot.x, player.y - bot.y);
                
                // Si el jugador está en un rango de ataque (150 a 300px)
                if (distToPlayer > 150 && distToPlayer < 300) {
                    // Calcular posición futura del jugador para cruzarse en su camino
                    const leadTime = 12; // Número de ticks al futuro
                    const targetX = player.x + Math.cos(player.angle) * player.speed * leadTime;
                    const targetY = player.y + Math.sin(player.angle) * player.speed * leadTime;
                    
                    bot.targetAngle = Math.atan2(targetY - bot.y, targetX - bot.x);
                    
                    // Activar turbo de forma táctica para rebasar e interponerse
                    bot.boosting = Math.random() < 0.15;
                    attacking = true;
                    break;
                }
            }
        }

        if (attacking) return;

        // 3. Buscar comida (Comportamiento normal e independiente)
        if (bot.botTimer % 12 === 0) {
            let closest = null;
            let minDist = 350;
            
            for (const p of room.pellets.values()) {
                const d = Math.hypot(p.x - bot.x, p.y - bot.y);
                
                if (d < minDist) {
                    // Evitar orbitar pellets: si está muy cerca y requiere un giro muy cerrado, ignorar
                    const angleToPellet = Math.atan2(p.y - bot.y, p.x - bot.x);
                    let angleDiff = angleToPellet - bot.angle;
                    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                    
                    // Si está a menos de 45px y requiere un giro brusco (> 0.6 rad), ignoramos este pellet
                    // Esto evita completamente que los bots se queden orbitando un orbe en círculos infinitos
                    if (d < 45 && Math.abs(angleDiff) > 0.6) {
                        continue;
                    }
                    
                    minDist = d;
                    closest = p;
                }
            }

            if (closest) {
                bot.targetAngle = Math.atan2(closest.y - bot.y, closest.x - bot.x);
            } else if (Math.random() < 0.20) {
                // Merodear de forma natural
                bot.targetAngle += (Math.random() - 0.5) * 1.2;
            }
        }

        // Apagar boost de forma normal si no está en peligro ni atacando
        if (!dangerDetected && !attacking) {
            bot.boosting = false;
        }
    }

    // ── Imán de pellets: atrae orbes cercanos hacia la cabeza de la serpiente ──
    const MAGNET_RADIUS  = 80;   // distancia máxima en px en la que el imán actúa
    const MAGNET_FORCE   = 0.18; // fracción de la distancia que se acorta por tick
    const MAGNET_EAT_DIST = 18;  // si el pellet llega a esta distancia, se come automáticamente

    function updateSnakePosition(snake, room) {
        if (!snake.alive) return;

        // ── Inercia angular (momentum de giro) ────────────────────────────────
        // Calculamos cuánto queremos girar este tick (diff normalizado).
        let diff = snake.targetAngle - snake.angle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI)  diff -= Math.PI * 2;

        // Velocidad máxima de giro por tick
        const MAX_TURN = 0.12;
        const desiredTurn = Math.max(-MAX_TURN, Math.min(MAX_TURN, diff));

        // La velocidad angular se acelera hacia el giro deseado (aceleración)
        // y se frena suavemente cuando no se aplica input (inercia natural).
        const ANGULAR_ACCEL  = 0.025;  // qué tan rápido gana velocidad de giro
        const ANGULAR_DECAY  = 0.82;   // factor de decaimiento cuando el input es neutro (< pequeño umbral)

        if (!snake.angularVelocity) snake.angularVelocity = 0;

        // Si el jugador está pidiendo girar, acumular velocidad angular
        if (Math.abs(diff) > 0.01) {
            snake.angularVelocity += (desiredTurn - snake.angularVelocity) * ANGULAR_ACCEL;
            // Clampar para no superar el límite máximo
            snake.angularVelocity = Math.max(-MAX_TURN, Math.min(MAX_TURN, snake.angularVelocity));
        } else {
            // Sin input → decaer suavemente la velocidad angular (inercia)
            snake.angularVelocity *= ANGULAR_DECAY;
            if (Math.abs(snake.angularVelocity) < 0.001) snake.angularVelocity = 0;
        }

        snake.angle += snake.angularVelocity;

        const MIN_SCORE = 100;
        const isBoosting = snake.boosting && snake.score > MIN_SCORE;
        const currentSpeed = isBoosting ? 8.5 : 4.8;
        snake.speed = currentSpeed;

        if (isBoosting) {
            // Consumo de energía más rápido: 0.8 por tick (a 40 FPS son 32 pts/seg, se encoge visiblemente rápido)
            snake.score -= 0.8;
            if (snake.score < MIN_SCORE) {
                snake.score = MIN_SCORE;
            }
            // Solo botar orbes ~3.5% del tiempo (original usa ~3-4%)
            if (Math.random() < 0.035) {
                const tail = snake.body[snake.body.length - 1];
                if (tail) {
                    const p = createPellet(tail.x, tail.y, 1);
                    room.pellets.set(p.id, p);
                }
            }
        }

        // Subdividir el movimiento en pequeños pasos de 1.5px para alta resolución en las curvas.
        // Esto evita que la serpiente se doble rígidamente (como palitos) a altas velocidades
        const dx = Math.cos(snake.angle) * snake.speed;
        const dy = Math.sin(snake.angle) * snake.speed;
        const stepSize = 1.5;
        const steps = Math.ceil(snake.speed / stepSize);
        const stepX = dx / steps;
        const stepY = dy / steps;

        if (!snake.history) {
            snake.history = [];
        }

        for (let s = 0; s < steps; s++) {
            snake.x += stepX;
            snake.y += stepY;
            // Registrar cada paso intermedio en la trayectoria
            snake.history.unshift({ x: snake.x, y: snake.y });
        }

        // Colisión con paredes (reducido a 10px para permitir rozar la línea roja sin morir antes de tiempo)
        if (snake.x < 10 || snake.x > WORLD_SIZE - 10 || snake.y < 10 || snake.y > WORLD_SIZE - 10) {
            snake.lastX = snake.x;
            snake.lastY = snake.y;
            snake.alive = false;
            return;
        }

        // Distancia fija entre segmentos (igual que en Snake.io)
        const SEGMENT_DISTANCE = 6;
        const desiredSegments = Math.floor(6 + snake.score / 15);
        const newBody = [];

        // El primer segmento es la cabeza
        newBody.push({ x: snake.x, y: snake.y });

        let currentIdx = 0;
        let accumulatedDist = 0;

        for (let i = 1; i < desiredSegments; i++) {
            let found = false;
            // Buscar a lo largo del historial el punto que está a SEGMENT_DISTANCE de distancia acumulada
            while (currentIdx < snake.history.length - 1) {
                const p1 = snake.history[currentIdx];
                const p2 = snake.history[currentIdx + 1];
                const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);

                if (accumulatedDist + d >= SEGMENT_DISTANCE) {
                    const remaining = SEGMENT_DISTANCE - accumulatedDist;
                    const ratio = remaining / d;
                    const segX = p1.x + (p2.x - p1.x) * ratio;
                    const segY = p1.y + (p2.y - p1.y) * ratio;

                    newBody.push({ x: segX, y: segY });

                    // Reemplazamos temporalmente la posición actual para medir desde el nuevo segmento creado
                    snake.history[currentIdx] = { x: segX, y: segY };
                    accumulatedDist = 0;
                    found = true;
                    break;
                } else {
                    accumulatedDist += d;
                    currentIdx++;
                }
            }

            // Si el historial aún no es tan largo (por ejemplo al spawnear), completamos con el último punto del historial
            if (!found) {
                const lastPt = snake.history[snake.history.length - 1] || { x: snake.x, y: snake.y };
                newBody.push({ x: lastPt.x, y: lastPt.y });
            }
        }

        snake.body = newBody;

        // Limitar la longitud del historial para evitar consumos de memoria
        const maxHistoryLength = desiredSegments * 5;
        if (snake.history.length > maxHistoryLength) {
            snake.history.length = maxHistoryLength;
        }

        // ── Imán de pellets + colisión ────────────────────────────────────────
        for (const [pId, p] of room.pellets.entries()) {
            const dist = Math.hypot(p.x - snake.x, p.y - snake.y);

            if (dist < p.radius + 12) {
                // Comer: el orbe está directamente tocando la cabeza
                snake.score += p.value;
                room.pellets.delete(pId);
            } else if (dist < MAGNET_RADIUS) {
                // Imán: mover el orbe hacia la cabeza de forma proporcional a la distancia
                const strength = MAGNET_FORCE * (1 - dist / MAGNET_RADIUS); // más fuerte cuanto más cerca
                p.x += (snake.x - p.x) * strength;
                p.y += (snake.y - p.y) * strength;

                // Si el imán lo acercó suficiente, comerlo
                const newDist = Math.hypot(p.x - snake.x, p.y - snake.y);
                if (newDist < MAGNET_EAT_DIST) {
                    snake.score += p.value;
                    room.pellets.delete(pId);
                }
            }
        }
    }

    function checkSnakeCollisions(allSnakes, room) {
        for (const snake of allSnakes) {
            if (!snake.alive) continue;

            for (const other of allSnakes) {
                if (!other.alive) continue;

                // REGLA ORIGINAL: NO hay auto-colisión.
                // La serpiente solo muere si choca contra el cuerpo de OTRA serpiente.
                if (other.id === snake.id) continue;

                for (let i = 0; i < other.body.length; i += 2) {
                    const seg = other.body[i];
                    const dist = Math.hypot(seg.x - snake.x, seg.y - snake.y);
                    if (dist < 12) {
                        snake.lastX = snake.x;
                        snake.lastY = snake.y;
                        snake.alive = false;
                        spawnDeathPellets(room, snake);
                        break;
                    }
                }
                if (!snake.alive) break;
            }
        }
    }

    function startArenaLoop(room) {
        clearInterval(room.gameLoop);
        room.gameLoop = setInterval(() => {
            const allSnakes = [...room.players.values(), ...room.bots.values()];

            // 1. Actualizar Bots
            for (const bot of room.bots.values()) {
                if (bot.alive) updateBotAI(room, bot);
            }

            // 2. Mover todas las serpientes
            for (const snake of allSnakes) {
                updateSnakePosition(snake, room);
            }

            // 3. Colisiones de cabeza contra cuerpos
            checkSnakeCollisions(allSnakes, room);

            // 4. Respawn de bots muertos en modo solo
            if (room.mode === 'solo') {
                for (const [bId, bot] of room.bots.entries()) {
                    if (!bot.alive) {
                        const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
                        room.bots.set(bId, createSnake(bId, botName, true));
                    }
                }
            }

            // 5. Mantener densidad de pellets
            while (room.pellets.size < INITIAL_PELLETS) {
                const p = createPellet();
                room.pellets.set(p.id, p);
            }

            // 6. Preparar Leaderboard
            const leaderboard = allSnakes
                .filter(s => s.alive)
                .map(s => ({ id: s.id, name: s.name, score: Math.floor(s.score), isBot: s.isBot }))
                .sort((a, b) => b.score - a.score)
                .slice(0, 10);

            // 7. Enviar datos a clientes en la sala
            for (const [sId, playerSnake] of room.players.entries()) {
                const clientSocket = slitherIo.sockets.get(sId);
                if (!clientSocket) continue;

                if (!playerSnake.alive) {
                    // Enviar gameOver solo una vez
                    if (!playerSnake.gameOverSent) {
                        clientSocket.emit('gameOver', { finalScore: Math.floor(playerSnake.score) });
                        playerSnake.gameOverSent = true;
                    }

                    // Modo espectador: seguir enviando el mundo desde la posición donde murió
                    const specX = playerSnake.lastX || playerSnake.x || WORLD_SIZE / 2;
                    const specY = playerSnake.lastY || playerSnake.y || WORLD_SIZE / 2;
                    const VIEW_MARGIN = 900;

                    const specSnakes = allSnakes
                        .filter(s => s.alive && Math.abs(s.x - specX) < VIEW_MARGIN && Math.abs(s.y - specY) < VIEW_MARGIN)
                        .map(s => ({
                            id: s.id,
                            name: s.name,
                            x: Math.round(s.x),
                            y: Math.round(s.y),
                            angle: s.angle,
                            color: s.color,
                            score: Math.floor(s.score),
                            body: s.body.map(pt => ({ x: Math.round(pt.x), y: Math.round(pt.y) }))
                        }));

                    const specPellets = [];
                    for (const p of room.pellets.values()) {
                        if (Math.abs(p.x - specX) < VIEW_MARGIN && Math.abs(p.y - specY) < VIEW_MARGIN) {
                            specPellets.push({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), radius: p.radius, color: p.color });
                        }
                    }

                    clientSocket.emit('tickState', {
                        me: null,
                        spectating: true,
                        spectatorPos: { x: Math.round(specX), y: Math.round(specY) },
                        snakes: specSnakes,
                        pellets: specPellets,
                        leaderboard,
                        worldSize: WORLD_SIZE
                    });
                    continue;
                }

                // Filtrar viewport (solo enviar lo que está cerca para optimización)
                const VIEW_MARGIN = 800;
                const visibleSnakes = allSnakes
                    .filter(s => s.alive && Math.abs(s.x - playerSnake.x) < VIEW_MARGIN && Math.abs(s.y - playerSnake.y) < VIEW_MARGIN)
                    .map(s => ({
                        id: s.id,
                        name: s.name,
                        x: Math.round(s.x),
                        y: Math.round(s.y),
                        angle: s.angle,
                        color: s.color,
                        score: Math.floor(s.score),
                        body: s.body.map(pt => ({ x: Math.round(pt.x), y: Math.round(pt.y) }))
                    }));

                const visiblePellets = [];
                for (const p of room.pellets.values()) {
                    if (Math.abs(p.x - playerSnake.x) < VIEW_MARGIN && Math.abs(p.y - playerSnake.y) < VIEW_MARGIN) {
                        visiblePellets.push({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), radius: p.radius, color: p.color });
                    }
                }

                clientSocket.emit('tickState', {
                    me: {
                        id: playerSnake.id,
                        x: Math.round(playerSnake.x),
                        y: Math.round(playerSnake.y),
                        score: Math.floor(playerSnake.score)
                    },
                    snakes: visibleSnakes,
                    pellets: visiblePellets,
                    leaderboard,
                    worldSize: WORLD_SIZE
                });
            }
        }, 25); // ~40 FPS — más suave, reduce saltos visuales
    }

    function getOrCreateMultiplayerRoom() {
        for (const room of rooms.values()) {
            if (room.mode === 'multiplayer' && room.players.size < MAX_PLAYERS_PER_ROOM) {
                return room;
            }
        }
        return createArenaRoom('multiplayer', 'Arena Multijugador Neón');
    }

    slitherIo.on('connection', (socket) => {
        socket.currentRoom = null;

        socket.on('joinGame', ({ alias, mode }, callback) => {
            const finalAlias = (alias || 'Serpiente').trim().slice(0, 12);
            const gameMode = mode === 'solo' ? 'solo' : 'multiplayer';

            let room;
            if (gameMode === 'solo') {
                room = createArenaRoom('solo', `Solo - ${finalAlias}`);
            } else {
                room = getOrCreateMultiplayerRoom();
            }

            const snake = createSnake(socket.id, finalAlias, false);
            room.players.set(socket.id, snake);
            socket.join(room.id);
            socket.currentRoom = room;

            if (typeof callback === 'function') {
                callback({ success: true, roomId: room.id, snakeId: socket.id });
            }
        });

        socket.on('updateInput', ({ targetAngle, boosting }) => {
            if (!socket.currentRoom) return;
            const snake = socket.currentRoom.players.get(socket.id);
            if (snake && snake.alive) {
                if (typeof targetAngle === 'number') snake.targetAngle = targetAngle;
                if (typeof boosting === 'boolean') snake.boosting = boosting;
            }
        });

        socket.on('respawn', ({ alias }, callback) => {
            if (!socket.currentRoom) return;
            const finalAlias = (alias || 'Serpiente').trim().slice(0, 12);
            const snake = createSnake(socket.id, finalAlias, false);
            socket.currentRoom.players.set(socket.id, snake);
            if (typeof callback === 'function') callback({ success: true });
        });

        socket.on('disconnect', () => {
            if (socket.currentRoom) {
                socket.currentRoom.players.delete(socket.id);
                if (socket.currentRoom.mode === 'solo' && socket.currentRoom.players.size === 0) {
                    clearInterval(socket.currentRoom.gameLoop);
                    rooms.delete(socket.currentRoom.id);
                }
            }
        });
    });
}

module.exports = setupSlitherGame;
