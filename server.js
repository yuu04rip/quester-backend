const express = require('express');
const { Pool } = require('pg');
const app = express();

app.use(express.json());

// Connessione a PostgreSQL (Render fornirà l'URL tramite la variabile d'ambiente DATABASE_URL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Funzione per inizializzare automaticamente le tabelle sul database
async function initDatabase() {
    const queryText = `
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255),
        password_hash VARCHAR(255) NOT NULL,
        xp_totale INT DEFAULT 0,
        livello INT DEFAULT 1,
        coins INT DEFAULT 0,
        equipped_hat VARCHAR(50) DEFAULT 'NONE',
        equipped_weapon VARCHAR(50) DEFAULT 'NONE',
        equipped_frame VARCHAR(50) DEFAULT 'NONE'
    );

    CREATE TABLE IF NOT EXISTS missions (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        type VARCHAR(50) NOT NULL,
        due_date VARCHAR(50),
        xp_reward INT DEFAULT 0,
        completed INT DEFAULT 0,
        xp_awarded INT DEFAULT 0,
        redeemed INT DEFAULT 0,
        created_at BIGINT NOT NULL,
        completed_at BIGINT,
        verification_level VARCHAR(50) DEFAULT 'AUTO',
        is_pinned INT DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS subtasks (
        id SERIAL PRIMARY KEY,
        mission_id INT REFERENCES missions(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        done INT DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS shop_items (
        item_id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        price INT NOT NULL,
        description TEXT,
        icon_name VARCHAR(100),
        icon_scale REAL DEFAULT 1.0
    );

    CREATE TABLE IF NOT EXISTS owned_cosmetics (
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        item_id VARCHAR(50) REFERENCES shop_items(item_id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, item_id)
    );
  `;

    try {
        await pool.query(queryText);
        console.log("Tabelle del database verificate/create con successo!");
    } catch (err) {
        console.error("Errore durante la creazione delle tabelle:", err);
    }
}

// Rotta di test per verificare che il server sia online
app.get('/', (req, res) => {
    res.send('Quester Backend is online and ready for action, Hero!');
});

// Endpoint per la Classifica Globale (Leaderboard) basata sul livello e XP
app.get('/api/leaderboard', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, livello, xp_totale, equipped_hat, equipped_frame FROM users ORDER BY livello DESC, xp_totale DESC LIMIT 50'
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// Endpoint per sincronizzare i dati dell'utente (profilo e progressi)
app.post('/api/sync/:userId', async (req, res) => {
    const userId = req.params.userId;
    const { xpTotale, livello, coins, equippedHat, equippedWeapon, equippedFrame } = req.body;

    try {
        await pool.query(
            `UPDATE users SET xp_totale = $1, livello = $2, coins = $3, equipped_hat = $4, equipped_weapon = $5, equipped_frame = $6 WHERE id = $7`,
            [xpTotale, livello, coins, equippedHat, equippedWeapon, equippedFrame, userId]
        );
        res.json({ success: true, message: 'Dati sincronizzati con successo' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Errore durante la sincronizzazione' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await initDatabase();
});