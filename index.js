const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion, Curve, generateRegistrationId } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const express = require('express');
const https = require('https');
const { Client: PGClient } = require('pg'); 

const app = express();
const PORT = process.env.PORT || 10000;
const RENDER_APP_URL = 'https://onrender.com'; 

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
            return JSON.parse(res.rows[0].data, (key, value) => {
                if (typeof value === 'string' && /^[a-zA-Z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0) {
                    try { return Buffer.from(value, 'base64'); } catch { return value; }
                }
                return value;
            });
        } catch (e) {
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

async function startBot() {
    // Reads directly from the Render Environment variables panel securely
    const pgClient = new PGClient({
        user: process.env.SUPABASE_USER || 'postgres.uknxovlystzlbydesaem',
        host: 'aws-0-ap-southeast-2.pooler.supabase.com',
        database: 'postgres',
        password: process.env.SUPABASE_PASSWORD || 'Nuggetdagod2023',
        port: 5432,
        ssl: { rejectUnauthorized: false }
    });
    
    await pgClient.connect();

    const { state, saveCreds } = await usePostgresAuthState(pgClient);
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

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(MY_PHONE_NUMBER);
                console.log('\n=======================================');
                console.log(`YOUR WHATSAPP PAIRING CODE: ${code}`);
                console.log('=======================================\n');
            } catch (err) {
                console.error('Failed to generate pairing code:', err.message);
            }
        }, 5000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('WhatsApp Bot is ready and running!');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed, reconnecting: ', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;

        for (const msg of m.messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const remoteJid = msg.key.remoteJid;
            const messageText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').toLowerCase().trim();

            if (messageText === 'hi') {
                const isMe = remoteJid.includes(sock.user.id.split(':'));

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
