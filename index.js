const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, Curve, generateRegistrationId } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const express = require('express');
const https = require('https');
const { Client: PGClient } = require('pg'); 

const app = express();
const PORT = process.env.PORT || 10000;
const RENDER_APP_URL = 'https://onrender.com'; 

// 1. Web server starts instantly
app.get('/', (req, res) => {
    res.send('Nugget King Bot is running online 24/7!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Web server listening on port ${PORT}.`);
    
    setInterval(() => {
        https.get(RENDER_APP_URL, (res) => {
            console.log(`Self-ping sent status: ${res.statusCode} (Keeping bot awake)`);
        }).on('error', (err) => {
            console.error('Ping error:', err.message);
        });
    }, 600000); 
});

async function usePostgresAuthState(pgClient) {
    await pgClient.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_session (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL
        )
    `);

    const writeData = async (data, id) => {
        const jsonStr = JSON.stringify(data, (key, value) => 
            Buffer.isBuffer(value) ? value.toString('base64') : value
        );
        await pgClient.query(
            'INSERT INTO whatsapp_session (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2',
            [id, jsonStr]
        );
    };

    const readData = async (id) => {
        try {
            const res = await pgClient.query('SELECT data FROM whatsapp_session WHERE id = $1', [id]);
            if (res.rows.length === 0) return null;
            
            // CRITICAL FIX: Changed from res.rows.data to res.rows[0].data
            return JSON.parse(res.rows[0].data, (key, value) => {
                if (typeof value === 'string' && /^[a-zA-Z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0) {
                    try { return Buffer.from(value, 'base64'); } catch { return value; }
                }
                return value;
            });
        } catch (e) {
            console.error('Error reading data:', e.message);
            return null;
        }
    };

    let creds = await readData('creds');
    if (!creds) {
        creds = {
            noiseKey: Curve.generateKeyPair(),
            signedIdentityKey: Curve.generateKeyPair(),
            signedPreKey: {
                keyPair: Curve.generateKeyPair(),
                signature: Buffer.alloc(64),
                keyId: 1
            },
            registrationId: generateRegistrationId(),
            advSecretKey: Buffer.alloc(32).toString('base64'),
            nextPreKeyId: 1,
            firstUnuploadedPreKeyId: 1,
            accountSettings: { unarchiveChats: false }
        };
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    for (const id of ids) {
                        let value = await readData(`${type}-${id}`);
                        data[id] = value;
                    }
                    return data;
                },
                set: async (data) => {
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            if (value) await writeData(value, `${category}-${id}`);
                            else await pgClient.query('DELETE FROM whatsapp_session WHERE id = $1', [`${category}-${id}`]);
                        }
                    }
                }
            }
        },
        saveCreds: async () => {
            await writeData(creds, 'creds');
        }
    };
}

// Global reference so we don't accidentally spin up parallel database clients
let pgClientInstance = null;

async function startBot() {
    console.log("Attempting database connection...");
    
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error("CRITICAL ERROR: DATABASE_URL environment variable is missing on Render!");
        return;
    }

    // Reuse database client connection instead of building new ones uncontrollably
    if (!pgClientInstance) {
        pgClientInstance = new PGClient({
            connectionString: connectionString,
            ssl: { rejectUnauthorized: false }
        });
        
        try {
            await pgClientInstance.connect();
            console.log("Successfully connected to Supabase Database!");
        } catch (dbErr) {
            console.error("Database connection failed completely:", dbErr.message);
            console.log("Retrying database connection in 15 seconds...");
            pgClientInstance = null;
            setTimeout(startBot, 15000);
            return;
        }
    }

    const { state, saveCreds } = await usePostgresAuthState(pgClientInstance);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version: version,
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        logger: pino({ level: 'silent' })
    });

    const MY_PHONE_NUMBER = '6587506845'; 

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('WhatsApp Bot is ready and running!');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`Connection closed. Reconnecting inside single track: ${shouldReconnect}`);
            
            if (shouldReconnect) {
                // FIX: Adding a 5-second cooldown delay before reconnecting to stop aggressive loops
                setTimeout(() => startBot(), 5000);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Pairing code handler
    setTimeout(async () => {
        if (!sock.authState.creds.registered) {
            try {
                console.log(`Requesting pairing code for phone number: ${MY_PHONE_NUMBER}`);
                const code = await sock.requestPairingCode(MY_PHONE_NUMBER);
                console.log('\n=======================================');
                console.log(`YOUR WHATSAPP PAIRING CODE: ${code}`);
                console.log('=======================================\n');
            } catch (err) {
                console.error('Failed to generate pairing code:', err.message);
            }
        }
    }, 15000); 

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const remoteJid = msg.key.remoteJid;
            const incomingText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const messageText = incomingText.toLowerCase().trim();

            if (messageText === 'hi') {
                if (!sock.user || !sock.user.id) continue;
                
                const cleanUserId = sock.user.id.split(':')[0];
                const isMe = remoteJid.includes(cleanUserId);

                if (isMe) {
                    await sock.sendMessage(remoteJid, { text: 'hi master' }, { quoted: msg });
                } else {
                    await sock.sendMessage(remoteJid, { text: 'hi the nugget king is here' }, { quoted: msg });
                }
            }
        }
    });
}

startBot();
