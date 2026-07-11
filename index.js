const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const express = require('express'); // Added web server interface

// --- RENDER PORT BINDING FIX ---
const app = express();
const PORT = process.env.PORT || 10000; // Render uses port 10000 by default

app.get('/', (req, res) => {
    res.send('Nugget King Bot is running online 24/7!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Web server listening on port ${PORT} to keep Render happy.`);
});
// --------------------------------

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version: version,
        auth: state,
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        logger: pino({ level: 'silent' }) 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n--- SCAN THIS NEW CODE ON YOUR PHONE ---');
            qrcode.generate(qr, { small: true });
            console.log('----------------------------------------\n');
        }

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
