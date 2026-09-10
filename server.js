// server.js (Backend Render - VERSIONE COMPLETA 2.1 con Shop Sync)
const express = require('express');
const { Pool } = require('pg');
const app = express();

app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

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
                                             equipped_frame VARCHAR(50) DEFAULT 'NONE',
                                             updated_at BIGINT DEFAULT 0
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
                                                is_pinned INT DEFAULT 0,
                                                updated_at BIGINT DEFAULT 0
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
        console.log("Database Quester V2 Pronto!");
    } catch (err) { console.error("Errore init DB:", err); }
}

app.get('/', (req, res) => {
    res.send('Quester Backend V2 is online!');
});

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
            `INSERT INTO users (username, email, password_hash, xp_totale, livello, coins, equipped_hat, equipped_weapon, equipped_frame, updated_at)
                 VALUES ($1, $2, $3, 0, 1, 0, 'NONE', 'NONE', 'NONE', $4) RETURNING id, username, email`,
            [cleanUsername, safeEmail, password, Date.now()]
        );
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Errore interno', details: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { identifier, password } = req.body;
    try {
        const cleanIdentifier = identifier.trim().toLowerCase();
        const result = await pool.query(
            'SELECT * FROM users WHERE username = $1 OR email = $1',
            [cleanIdentifier]
        );
        if (result.rows.length === 0 || result.rows[0].password_hash !== password) {
            return res.status(401).json({ error: 'Credenziali non valide' });
        }
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Errore interno', details: err.message });
    }
});

app.post('/api/sync/:userId', async (req, res) => {
    const userId = req.params.userId;
    const { username, xpTotale, livello, coins, equippedHat, equippedWeapon, equippedFrame, updated_at } = req.body;
    const clientTs = updated_at || Date.now();

    try {
        const safeUsername = (username || `Hero_${userId}`).trim().toLowerCase();
        const safeEmail = `${safeUsername}_${userId}@quester.app`;

        const existingUser = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
        const existingPasswordHash = existingUser.rows.length > 0 ? existingUser.rows[0].password_hash : 'oauth_placeholder';

        const queryText = `
            INSERT INTO users (id, username, email, password_hash, xp_totale, livello, coins, equipped_hat, equipped_weapon, equipped_frame, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (id)
            DO UPDATE SET
                username = EXCLUDED.username,
                email = EXCLUDED.email,
                xp_totale = EXCLUDED.xp_totale,
                livello = EXCLUDED.livello,
                coins = EXCLUDED.coins,
                equipped_hat = EXCLUDED.equipped_hat,
                equipped_weapon = EXCLUDED.equipped_weapon,
                equipped_frame = EXCLUDED.equipped_frame,
                updated_at = EXCLUDED.updated_at
                WHERE EXCLUDED.updated_at >= users.updated_at;
        `;

        await pool.query(queryText, [
            userId, safeUsername, safeEmail, existingPasswordHash,
            xpTotale || 0, livello || 1, coins || 0,
            equippedHat || 'NONE', equippedWeapon || 'NONE', equippedFrame || 'NONE',
            clientTs
        ]);

        res.json({ success: true, server_time: Date.now() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/sync/mission/:userId', async (req, res) => {
    const userId = req.params.userId;
    const m = req.body;
    const clientTs = m.updated_at || Date.now();

    try {
        const missionQuery = `
            INSERT INTO missions (id, user_id, title, description, type, due_date, xp_reward, completed, xp_awarded, redeemed, created_at, completed_at, verification_level, is_pinned, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
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
                is_pinned = EXCLUDED.is_pinned,
                updated_at = EXCLUDED.updated_at
                WHERE EXCLUDED.updated_at >= missions.updated_at
                RETURNING id;
        `;
        const result = await pool.query(missionQuery, [
            m.id, userId, m.title, m.description, m.type, m.due_date,
            m.xp_reward, m.completed, m.xp_awarded, m.redeemed,
            m.created_at, m.completed_at, m.verification_level, m.is_pinned, clientTs
        ]);

        if (result.rows.length > 0 && m.subtasks) {
            await pool.query('DELETE FROM subtasks WHERE mission_id = $1', [m.id]);
            for (const sub of m.subtasks) {
                await pool.query('INSERT INTO subtasks (mission_id, text, done) VALUES ($1, $2, $3)', [m.id, sub.text, sub.done]);
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/sync/cosmetics/:userId', async (req, res) => {
    const userId = req.params.userId;
    const { item_ids } = req.body;

    try {
        if (item_ids && Array.isArray(item_ids)) {
            await pool.query('DELETE FROM owned_cosmetics WHERE user_id = $1', [userId]);
            for (const itemId of item_ids) {
                await pool.query(
                    'INSERT INTO owned_cosmetics (user_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [userId, itemId]
                );
            }
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/user/:userId/data', async (req, res) => {
    const userId = req.params.userId;
    try {
        const user = (await pool.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
        if (!user) return res.status(404).json({ error: 'Utente non trovato' });

        const missions = (await pool.query('SELECT * FROM missions WHERE user_id = $1', [userId])).rows;
        for (let m of missions) {
            m.subtasks = (await pool.query('SELECT * FROM subtasks WHERE mission_id = $1', [m.id])).rows;
        }

        const ownedRes = await pool.query('SELECT item_id FROM owned_cosmetics WHERE user_id = $1', [userId]);
        const owned_items = ownedRes.rows.map(r => r.item_id);

        res.json({ user, missions, owned_items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    await initDatabase();
    console.log(`Hero Backend V2 on port ${PORT}`);
});