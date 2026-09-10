const express = require('express');
const { Pool } = require('pg');
const app = express();

app.use(express.json());

// Connessione a PostgreSQL (Render fornirà l'URL tramite la variabile d'ambiente DATABASE_URL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

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
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});