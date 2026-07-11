const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
    }
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('QR CODE CREATED:');
    console.log(qr); // This prints the raw string so you can see it in cloud logs
});

client.on('ready', () => {
    console.log('WhatsApp Bot is ready and running!');
});

client.on('message', async (msg) => {
    const messageText = msg.body.toLowerCase().trim();
    if (messageText === 'hi') {
        if (msg.fromMe || msg.to === msg.from) {
            await msg.reply('hi master');
        } else {
            await msg.reply('hi the nugget king is here');
        }
    }
});

client.initialize();
ss