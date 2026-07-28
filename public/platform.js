document.addEventListener('DOMContentLoaded', () => {
    fetchGames();
});

async function fetchGames() {
    const grid = document.getElementById('gamesGrid');
    grid.innerHTML = '<div style="color:#94a3b8; font-family:Orbitron;">Cargando catálogo de juegos...</div>';

    try {
        const res = await fetch('/api/games');
        const games = await res.json();
        renderGames(games);
    } catch (e) {
        console.error('Error cargando juegos:', e);
        grid.innerHTML = '<div style="color:#ff0055; font-family:Orbitron;">Error al conectar con el catálogo.</div>';
    }
}

function renderGames(games) {
    const grid = document.getElementById('gamesGrid');
    grid.innerHTML = '';

    if (!games || games.length === 0) {
        grid.innerHTML = '<div style="color:#94a3b8; font-family:Orbitron;">No hay juegos disponibles.</div>';
        return;
    }

    document.getElementById('totalGamesVal').innerText = games.length;

    games.forEach(game => {
        const card = document.createElement('div');
        card.className = 'game-card';

        card.innerHTML = `
            <div>
                <div class="game-card-header">
                    <div class="game-icon">${game.icon || '🎮'}</div>
                    <span class="game-badge">${game.badge || 'Multijugador'}</span>
                </div>
                <div class="game-card-body" style="margin-top: 15px;">
                    <h3 class="game-title">${escapeHTML(game.name)}</h3>
                    <p class="game-desc">${escapeHTML(game.description)}</p>
                </div>
            </div>
            <div class="game-card-footer">
                <div class="game-players-info">
                    👥 ${game.minPlayers} - ${game.maxPlayers} Jugadores
                </div>
                <a href="${game.path}" class="play-btn">JUGAR 🎮</a>
            </div>
        `;

        grid.appendChild(card);
    });
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}
