const fs = require('fs');
const path = require('path');

class GameRegistry {
    constructor() {
        this.games = new Map();
    }

    init() {
        const gamesDir = path.join(__dirname, '../games');
        if (!fs.existsSync(gamesDir)) {
            fs.mkdirSync(gamesDir, { recursive: true });
        }

        const gameFolders = fs.readdirSync(gamesDir);
        for (const folder of gameFolders) {
            const manifestPath = path.join(gamesDir, folder, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
                try {
                    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    this.games.set(manifest.id, manifest);
                    console.log(`[+] Juego registrado: ${manifest.name} (${manifest.id})`);
                } catch (e) {
                    console.error(`[-] Error leyendo manifest en ${folder}:`, e.message);
                }
            }
        }
    }

    getAllGames() {
        return Array.from(this.games.values());
    }

    getGame(id) {
        return this.games.get(id);
    }
}

module.exports = new GameRegistry();
