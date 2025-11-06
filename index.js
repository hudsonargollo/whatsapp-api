const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const dotenv = require('dotenv');
const fs = require('fs');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Função para iniciar a conexão com o WhatsApp
async function connectToWhatsApp() {
    // O Coolify pode usar um volume persistente para armazenar o estado da sessão
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            // Reconnectar se não for um loggout
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('opened connection');
        }
        
        if (qr) {
            console.log('QR Code gerado. Escaneie com seu celular:');
            // Aqui você pode salvar o QR em um arquivo ou enviar para um webhook
            // Para o Coolify, o ideal é que o usuário escaneie o QR via log ou um endpoint
        }
    });

    sock.ev.on('creds.update', saveCreds);

    return sock;
}

let sock;
connectToWhatsApp().then(s => {
    sock = s;
}).catch(err => console.error("Erro ao conectar ao WhatsApp:", err));


// Endpoint para enviar mensagem
app.post('/send-message', async (req, res) => {
    const { to, message } = req.body; // 'to' deve ser no formato '5511999999999@s.whatsapp.net'

    if (!sock || !sock.user) {
        return res.status(503).json({ error: 'WhatsApp not connected or ready.' });
    }

    if (!to || !message) {
        return res.status(400).json({ error: 'Missing "to" or "message" in request body.' });
    }

    try {
        // O número deve ser no formato '5511999999999@s.whatsapp.net'
        const jid = to.includes('@s.whatsapp.net') ? to : `${to}@s.whatsapp.net`;
        const result = await sock.sendMessage(jid, { text: message });
        res.json({ success: true, result });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message.' });
    }
});

// Endpoint de saúde (Health Check)
app.get('/status', (req, res) => {
    res.json({ 
        status: sock && sock.user ? 'connected' : 'disconnected',
        user: sock && sock.user ? sock.user.id : null
    });
});

app.listen(PORT, () => {
    console.log(`WhatsApp API running on port ${PORT}`);
});
