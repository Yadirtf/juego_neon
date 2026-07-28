const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const gameRegistry = require('./server/platform/gameRegistry');
const setupTronGame = require('./server/games/tron/tronGame');
const setupSlitherGame = require('./server/games/slither/slitherGame');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Descubrimiento automático de juegos registrados
gameRegistry.init();

// Servir estáticos desde public (incluye hub y juegos)
app.use(express.static(path.join(__dirname, 'public')));

// API Endpoint para obtener el catálogo de juegos
app.get('/api/games', (req, res) => {
    res.json(gameRegistry.getAllGames());
});

// API Endpoint para estadisticas del servidor
app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        uptime: process.uptime(),
        gamesCount: gameRegistry.getAllGames().length
    });
});

// Montar motores de juegos aislados en namespaces de Socket.IO
setupTronGame(io);
setupSlitherGame(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('==================================================');
    console.log('🚀 PLATAFORMA NEON ARCADE INICIADA CON ÉXITO');
    console.log(`🌐 Servidor escuchando en http://localhost:${PORT}`);
    console.log('==================================================');
});