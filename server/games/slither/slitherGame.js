const WORLD_SIZE = 3000;
const MAX_PLAYERS_PER_ROOM = 25;
const INITIAL_PELLETS = 400;
const SPAWN_SHIELD_MS = 2500;
const REMAIN_HOLE_LINGER_MS = 850;
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

    function findPlayerSpawnPoint(room) {
        const others = [...room.players.values(), ...room.bots.values()].filter(s => s.alive);
        for (let attempt = 0; attempt < 30; attempt++) {
            const x = Math.floor(Math.random() * (WORLD_SIZE - 400)) + 200;
            const y = Math.floor(Math.random() * (WORLD_SIZE - 400)) + 200;
            let clear = true;
            for (const s of others) {
                if (Math.hypot(s.x - x, s.y - y) < 200) {
                    clear = false;
                    break;
                }
                for (let i = 0; i < s.body.length; i += 2) {
                    const seg = s.body[i];
                    if (Math.hypot(seg.x - x, seg.y - y) < 130) {
                        clear = false;
                        break;
                    }
                }
                if (!clear) break;
            }
            if (clear) return { x, y };
        }
        return {
            x: Math.floor(Math.random() * (WORLD_SIZE - 400)) + 200,
            y: Math.floor(Math.random() * (WORLD_SIZE - 400)) + 200
        };
    }

    function getSpawnShieldRatio(snake) {
        if (snake.isBot || !snake.spawnShieldUntil) return 0;
        return Math.max(0, Math.min(1, (snake.spawnShieldUntil - Date.now()) / SPAWN_SHIELD_MS));
    }

    function hasSpawnShield(snake) {
        return getSpawnShieldRatio(snake) > 0;
    }

    function serializeSnake(s) {
        const shield = getSpawnShieldRatio(s);
        return {
            id: s.id,
            name: s.name,
            x: Math.round(s.x),
            y: Math.round(s.y),
            angle: s.angle,
            color: s.color,
            score: Math.floor(s.score),
            body: s.body.map(pt => ({ x: Math.round(pt.x), y: Math.round(pt.y) })),
            shield: shield > 0.02 ? Math.round(shield * 100) / 100 : 0,
            growthHole: serializeGrowthHole(s)
        };
    }

    function serializeGrowthHole(s) {
        if (!s.growthHole) return null;
        const fade = typeof s.growthHoleFade === 'number' ? s.growthHoleFade : 0;
        return {
            x: Math.round(s.growthHole.x),
            y: Math.round(s.growthHole.y),
            fade: Math.round(fade * 100) / 100
        };
    }

    function registerRemainMeal(snake) {
        snake.lastRemainEatAt = Date.now();
        const tail = snake.body && snake.body[snake.body.length - 1];
        if (!tail) return;
        if (!snake.growthHole) {
            snake.growthHole = { x: tail.x, y: tail.y };
        }
    }

    function updateGrowthHole(snake) {
        if (!snake.lastRemainEatAt) {
            snake.growthHole = null;
            snake.growthHoleFade = 0;
            return;
        }

        const elapsed = Date.now() - snake.lastRemainEatAt;
        if (elapsed > REMAIN_HOLE_LINGER_MS) {
            snake.growthHole = null;
            snake.growthHoleFade = 0;
            snake.lastRemainEatAt = 0;
            return;
        }

        const tail = snake.body && snake.body[snake.body.length - 1];
        if (tail) {
            if (!snake.growthHole) snake.growthHole = { x: tail.x, y: tail.y };
            else {
                snake.growthHole.x += (tail.x - snake.growthHole.x) * 0.32;
                snake.growthHole.y += (tail.y - snake.growthHole.y) * 0.32;
            }
        }

        const fadeStart = REMAIN_HOLE_LINGER_MS * 0.55;
        if (elapsed > fadeStart) {
            snake.growthHoleFade = (elapsed - fadeStart) / (REMAIN_HOLE_LINGER_MS - fadeStart);
        } else {
            snake.growthHoleFade = 0;
        }
    }

    function createSnake(id, name, isBot = false, room = null) {
        const spawn = !isBot && room ? findPlayerSpawnPoint(room) : null;
        const x = spawn ? spawn.x : Math.floor(Math.random() * (WORLD_SIZE - 400)) + 200;
        const y = spawn ? spawn.y : Math.floor(Math.random() * (WORLD_SIZE - 400)) + 200;
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
            botTimer: 0,
            spawnShieldUntil: isBot ? 0 : Date.now() + SPAWN_SHIELD_MS,
            gameOverSent: false,
            lastRemainEatAt: 0,
            growthHole: null,
            growthHoleFade: 0
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
            p.isRemain = true;
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

    // ── Imán de pellets: vacío hacia la boca (frente de la cabeza) ──
    const MAGNET_RADIUS     = 105;
    const MAGNET_FORCE      = 0.32;
    const MAGNET_EAT_DIST   = 26;
    const MOUTH_OFFSET      = 18;
    const MAGNET_SIDE_GRACE = 52;

    function normalizeAngleDiff(diff) {
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        return diff;
    }

    function getMouthPoint(snake) {
        return {
            x: snake.x + Math.cos(snake.angle) * MOUTH_OFFSET,
            y: snake.y + Math.sin(snake.angle) * MOUTH_OFFSET
        };
    }

    function tryEatPellet(snake, room, pId, p) {
        snake.score += p.value;
        if (p.isRemain) registerRemainMeal(snake);
        room.pellets.delete(pId);
    }

    function updateSnakePosition(snake, room) {
        if (!snake.alive) return;

        // ── Giro: jugadores ágiles; bots con inercia suave ────────────────────
        let diff = normalizeAngleDiff(snake.targetAngle - snake.angle);
        const turnPower = typeof snake.turnPower === 'number'
            ? Math.max(0.25, Math.min(1, snake.turnPower))
            : 1;

        if (!snake.isBot) {
            const MAX_TURN_PLAYER = 0.19 * turnPower;
            if (Math.abs(diff) > 0.003) {
                // Respuesta directa pero amortiguada: sigue el joystick sin sensación “pegada”
                const step = diff * (0.55 + 0.35 * turnPower);
                snake.angle += Math.max(-MAX_TURN_PLAYER, Math.min(MAX_TURN_PLAYER, step));
            }
            snake.angularVelocity = 0;
        } else {
            const MAX_TURN = 0.12;
            const desiredTurn = Math.max(-MAX_TURN, Math.min(MAX_TURN, diff));
            const ANGULAR_ACCEL = 0.025;
            const ANGULAR_DECAY = 0.82;

            if (!snake.angularVelocity) snake.angularVelocity = 0;

            if (Math.abs(diff) > 0.01) {
                snake.angularVelocity += (desiredTurn - snake.angularVelocity) * ANGULAR_ACCEL;
                snake.angularVelocity = Math.max(-MAX_TURN, Math.min(MAX_TURN, snake.angularVelocity));
            } else {
                snake.angularVelocity *= ANGULAR_DECAY;
                if (Math.abs(snake.angularVelocity) < 0.001) snake.angularVelocity = 0;
            }

            snake.angle += snake.angularVelocity;
        }

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

        // ── Imán hacia la boca + colisión generosa al pasar cerca ───────────────
        const mouth = getMouthPoint(snake);

        for (const [pId, p] of room.pellets.entries()) {
            const distHead = Math.hypot(p.x - snake.x, p.y - snake.y);
            const distMouth = Math.hypot(p.x - mouth.x, p.y - mouth.y);
            const eatRadius = p.radius + 15;

            if (distHead < eatRadius || distMouth < MAGNET_EAT_DIST) {
                tryEatPellet(snake, room, pId, p);
                continue;
            }

            if (distHead >= MAGNET_RADIUS) continue;

            const angleToPellet = Math.atan2(p.y - snake.y, p.x - snake.x);
            const frontalDiff = Math.abs(normalizeAngleDiff(angleToPellet - snake.angle));
            const inFrontCone = frontalDiff < Math.PI * 0.52;
            const inGraceBand = distHead < MAGNET_SIDE_GRACE;

            if (!inFrontCone && !inGraceBand) continue;

            const proximity = 1 - distHead / MAGNET_RADIUS;
            let strength = MAGNET_FORCE * (0.4 + 0.6 * proximity * proximity);
            if (distHead < 50) strength = Math.max(strength, 0.48);
            if (inGraceBand && !inFrontCone) strength *= 0.65;

            p.x += (mouth.x - p.x) * strength;
            p.y += (mouth.y - p.y) * strength;

            const afterHead = Math.hypot(p.x - snake.x, p.y - snake.y);
            const afterMouth = Math.hypot(p.x - mouth.x, p.y - mouth.y);
            if (afterHead < eatRadius || afterMouth < MAGNET_EAT_DIST || afterHead < MAGNET_SIDE_GRACE * 0.85) {
                tryEatPellet(snake, room, pId, p);
            }
        }

        updateGrowthHole(snake);
    }

    function checkSnakeCollisions(allSnakes, room) {
        for (const snake of allSnakes) {
            if (!snake.alive) continue;

            for (const other of allSnakes) {
                if (!other.alive) continue;

                // REGLA ORIGINAL: NO hay auto-colisión.
                // La serpiente solo muere si choca contra el cuerpo de OTRA serpiente.
                if (other.id === snake.id) continue;

                // Escudo de aparición: nadie muere ni mata hasta que termine (ambos lados)
                if (hasSpawnShield(snake) || hasSpawnShield(other)) continue;

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
                        .map(s => serializeSnake(s));

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
                    .map(s => serializeSnake(s));

                const visiblePellets = [];
                for (const p of room.pellets.values()) {
                    if (Math.abs(p.x - playerSnake.x) < VIEW_MARGIN && Math.abs(p.y - playerSnake.y) < VIEW_MARGIN) {
                        visiblePellets.push({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), radius: p.radius, color: p.color });
                    }
                }

                const playerShield = getSpawnShieldRatio(playerSnake);
                clientSocket.emit('tickState', {
                    me: {
                        id: playerSnake.id,
                        x: Math.round(playerSnake.x),
                        y: Math.round(playerSnake.y),
                        score: Math.floor(playerSnake.score),
                        shield: playerShield > 0.02 ? Math.round(playerShield * 100) / 100 : 0
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

            const snake = createSnake(socket.id, finalAlias, false, room);
            room.players.set(socket.id, snake);
            socket.join(room.id);
            socket.currentRoom = room;

            if (typeof callback === 'function') {
                callback({ success: true, roomId: room.id, snakeId: socket.id });
            }
        });

        socket.on('updateInput', ({ targetAngle, boosting, turnPower }) => {
            if (!socket.currentRoom) return;
            const snake = socket.currentRoom.players.get(socket.id);
            if (snake && snake.alive) {
                if (typeof targetAngle === 'number') snake.targetAngle = targetAngle;
                if (typeof boosting === 'boolean') snake.boosting = boosting;
                if (typeof turnPower === 'number') snake.turnPower = turnPower;
            }
        });

        socket.on('respawn', ({ alias }, callback) => {
            if (!socket.currentRoom) return;
            const finalAlias = (alias || 'Serpiente').trim().slice(0, 12);
            const snake = createSnake(socket.id, finalAlias, false, socket.currentRoom);
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
