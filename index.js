async function startBot() {
    // FIX: Using connectionString to read your Render environment variable dynamically
    const pgClient = new PGClient({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    
    try {
        await pgClient.connect();
        console.log("Successfully connected to Supabase Database!");
    } catch (dbErr) {
        console.error("Database connection failed:", dbErr.message);
        process.exit(1); // Stop process cleanly if DB fails
    }

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

    sock.ev.on('connection.update', async (update) => {
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

    sock.ev.on('creds.update', saveCreds);

    // FIX: Optimized conditions for generating Pairing Codes cleanly without infinite loops
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
            // FIX: Graceful handling of message types to prevent application crashes
            const incomingText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const messageText = incomingText.toLowerCase().trim();

            if (messageText === 'hi') {
                // FIX: Cleaner identification of self commands
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
