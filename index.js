const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

async function startBot() {
    // Saves your login details locally on Render's server so you stay logged in
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false // We will handle printing manually below for cleaner logs
    });

    // Save changes to login session details
    sock.ev.on('creds.update', saveCreds);

    // Handle connection states (QR generation / Booting up)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n--- SCAN THIS CODE ON YOUR PHONE ---');
            qrcode.generate(qr, { small: true });
            console.log('------------------------------------\n');
        }

        if (connection === 'open') {
            console.log('WhatsApp Bot is ready and running!');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting: ', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        }
    });

    // Listen for incoming messages
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return; // Ignore empty messages or messages you sent yourself

        const remoteJid = msg.key.remoteJid;
        // Extract incoming text from conversation or extended content fields
        const messageText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').toLowerCase().trim();

        if (messageText === 'hi') {
            // Check if you are texting yourself in your personal notepad chat
            const isMe = remoteJid.includes(sock.user.id.split(':')[0]);

            if (isMe) {
                await sock.sendMessage(remoteJid, { text: 'hi master' }, { quoted: msg });
            } else {
                // If anyone else sends "hi"
                await sock.sendMessage(remoteJid, { text: 'hi the nugget king is here' }, { quoted: msg });
            }
        }
    });
}

startBot();

