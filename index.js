const wppconnect = require('@wppconnect-team/wppconnect');

wppconnect
  .create({
    session: 'nugget-king-session',
    catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
      console.log('\n--- SCAN THIS CODE ON YOUR PHONE ---');
      console.log(asciiQR); // Prints the visual text QR code in Render logs
      console.log('------------------------------------\n');
    },
    puppeteerOptions: {
      userDataDir: './tokens', // Saves your login details locally on the server
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  })
  .then((client) => startBot(client))
  .catch((error) => console.log('Initialization Error:', error));

function startBot(client) {
  console.log('WhatsApp Bot is ready and running!');

  // Listen for incoming messages
  client.onMessage(async (message) => {
    // If the message isn't text, ignore it
    if (!message.body) return;

    const messageText = message.body.toLowerCase().trim();

    if (messageText === 'hi') {
      // Check if you sent it to yourself or if it's from your own profile
      if (message.fromMe || message.to === message.from) {
        await client.reply(message.from, 'hi master', message.id);
      } else {
        // If anyone else sends "hi"
        await client.reply(message.from, 'hi the nugget king is here', message.id);
      }
    }
  });
}
