// server.js (Backend Node.js per Render)

const express = require('express');
const { Pool } = require('pg');
const app = express();

app.use(express.json());

// Connessione a PostgreSQL
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

// Rotta di test
app.get('/', (req, res) => {
    res.send('Quester Backend is online and ready for action, Hero!');
});

// Endpoint per la Registrazione
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;

    try {
        const cleanUsername = username.trim().toLowerCase();
        const checkUser = await pool.query('SELECT * FROM users WHERE username = $1', [cleanUsername]);
        if (checkUser.rows.length > 0) {
            return res.status(400).json({ error: 'Username già esistente' });
        }

        const safeEmail = email || `${cleanUsername}_${Date.now()}@quester.app`;

        const result = await pool.query(
            `INSERT INTO users (username, email, password_hash, xp_totale, livello, coins, equipped_hat, equipped_weapon, equipped_frame)
                 VALUES ($1, $2, $3, 0, 1, 0, 'NONE', 'NONE', 'NONE') RETURNING id, username, email`,
            [cleanUsername, safeEmail, password]
        );

        const newUser = result.rows[0];
        console.log(`[REGISTER] Nuovo eroe registrato: ${newUser.username} (ID: ${newUser.id})`);
        res.json({ success: true, user: newUser });
    } catch (err) {
        console.error("Errore durante la registrazione:", err);
        res.status(500).json({ error: 'Errore interno del server', details: err.message });
    }
});

// Endpoint per il Login
app.post('/api/login', async (req, res) => {
    const { identifier, password } = req.body;

    try {
        const cleanIdentifier = identifier.trim().toLowerCase();
        const result = await pool.query(
            'SELECT * FROM users WHERE username = $1 OR email = $1',
            [cleanIdentifier]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Credenziali non valide' });
        }

        const user = result.rows[0];

        if (user.password_hash !== password) {
            return res.status(401).json({ error: 'Credenziali non valide' });
        }

        console.log(`[LOGIN] Eroe rientrato nel regno: ${user.username} (ID: ${user.id})`);
        res.json({ success: true, user: user });
    } catch (err) {
        console.error("Errore durante il login:", err);
        res.status(500).json({ error: 'Errore interno del server', details: err.message });
    }
});

// Endpoint per la Classifica Globale
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

// Endpoint per scaricare tutti i dati dell'utente (Profilo + Missioni + Subtasks)
app.get('/api/user/:userId/data', async (req, res) => {
    const userId = req.params.userId;

    try {
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'Utente non trovato sul cloud' });
        }
        const user = userResult.rows[0];

        const missionsResult = await pool.query('SELECT * FROM missions WHERE user_id = $1', [userId]);
        const missions = missionsResult.rows;

        const missionsWithSubtasks = [];
        for (const mission of missions) {
            const subtasksResult = await pool.query('SELECT * FROM subtasks WHERE mission_id = $1', [mission.id]);
            missionsWithSubtasks.push({
                ...mission,
                subtasks: subtasksResult.rows
            });
        }

        res.json({
            user: user,
            missions: missionsWithSubtasks
        });
    } catch (err) {
        console.error("Errore durante il recupero dei dati utente:", err);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// Endpoint per sincronizzare i dati dell'utente
app.post('/api/sync/:userId', async (req, res) => {
    const userId = req.params.userId;
    const { username, xpTotale, livello, coins, equippedHat, equippedWeapon, equippedFrame } = req.body;

    try {
        const safeUsername = (username || `Hero_${userId}`).trim().toLowerCase();
        const safeEmail = `${safeUsername}_${userId}@quester.app`;

        const existingUser = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
        const existingPasswordHash = existingUser.rows.length > 0 ? existingUser.rows[0].password_hash : 'oauth_placeholder';

        const queryText = `
            INSERT INTO users (id, username, email, password_hash, xp_totale, livello, coins, equipped_hat, equipped_weapon, equipped_frame)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (id)
            DO UPDATE SET
                username = EXCLUDED.username,
                email = EXCLUDED.email,
                xp_totale = EXCLUDED.xp_totale,
                livello = EXCLUDED.livello,
                coins = EXCLUDED.coins,
                equipped_hat = EXCLUDED.equipped_hat,
                equipped_weapon = EXCLUDED.equipped_weapon,
                equipped_frame = EXCLUDED.equipped_frame;
        `;

        await pool.query(queryText, [
            userId,
            safeUsername,
            safeEmail,
            existingPasswordHash,
            xpTotale || 0,
            livello || 1,
            coins || 0,
            equippedHat || 'NONE',
            equippedWeapon || 'NONE',
            equippedFrame || 'NONE'
        ]);

        console.log(`[SYNC] Utente ${userId} (${safeUsername}) sincronizzato con successo!`);
        res.json({ success: true, message: 'Dati sincronizzati con successo' });
    } catch (err) {
        console.error("Errore durante la sincronizzazione dell'utente:", err);
        res.status(500).json({ error: 'Errore durante la sincronizzazione', details: err.message });
    }
});

// Endpoint per sincronizzare una singola missione e relativi subtasks
app.post('/api/sync/mission/:userId', async (req, res) => {
    const userId = req.params.userId;
    const { id, title, description, type, due_date, xp_reward, completed, xp_awarded, redeemed, created_at, completed_at, verification_level, is_pinned, subtasks } = req.body;

    try {
        const missionQuery = `
            INSERT INTO missions (id, user_id, title, description, type, due_date, xp_reward, completed, xp_awarded, redeemed, created_at, completed_at, verification_level, is_pinned)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            ON CONFLICT (id)
            DO UPDATE SET
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                type = EXCLUDED.type,
                due_date = EXCLUDED.due_date,
                xp_reward = EXCLUDED.xp_reward,
                completed = EXCLUDED.completed,
                xp_awarded = EXCLUDED.xp_awarded,
                redeemed = EXCLUDED.redeemed,
                completed_at = EXCLUDED.completed_at,
                verification_level = EXCLUDED.verification_level,
                is_pinned = EXCLUDED.is_pinned
            RETURNING id;
        `;

        const missionResult = await pool.query(missionQuery, [
            id, userId, title, description, type, due_date, xp_reward, completed, xp_awarded, redeemed, created_at, completed_at, verification_level, is_pinned
        ]);

        const missionId = missionResult.rows[0].id;

        if (subtasks && Array.isArray(subtasks)) {
            await pool.query('DELETE FROM subtasks WHERE mission_id = $1', [missionId]);

            for (const sub of subtasks) {
                await pool.query(
                    `INSERT INTO subtasks (mission_id, text, done) VALUES ($1, $2, $3)`,
                    [missionId, sub.text, sub.done]
                );
            }
        }

        res.json({ success: true, missionId });
    } catch (err) {
        console.error("Errore durante la sincronizzazione della missione:", err);
        res.status(500).json({ error: 'Errore interno del server', details: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await initDatabase();
});