const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const pino = require('pino');
const dotenv = require('dotenv');
const qrcode = require('qrcode-terminal'); // NOVO: Módulo para gerar QR Code no terminal

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

let sock;

// Função para iniciar a conexão com o WhatsApp
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Desabilita a impressão automática
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada:', lastDisconnect.error, ', reconectando:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            console.log('Conexão aberta com sucesso!');
        }
        
        if (qr) {
            // NOVO: Imprime o QR Code usando o qrcode-terminal
            qrcode.generate(qr, { small: true });
            console.log('QR Code gerado. Escaneie com seu celular.');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Inicia a conexão
connectToWhatsApp().catch(err => console.error("Erro inicial ao conectar ao WhatsApp:", err));

// Rota principal para Health Check do Coolify
app.get('/', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'WhatsApp API is running.' });
});

// Endpoint para enviar mensagem
app.post('/send-message', async (req, res) => {
    const { to, message } = req.body;

    if (!sock || sock.user?.id === undefined) {
        return res.status(503).json({ error: 'WhatsApp não está conectado ou pronto.' });
    }

    if (!to || !message) {
        return res.status(400).json({ error: 'Faltando "to" ou "message" no corpo da requisição.' });
    }

    try {
        const jid = to.includes('@s.whatsapp.net') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao enviar mensagem:', error);
        res.status(500).json({ error: 'Falha ao enviar mensagem.' });
    }
});

// Endpoint de status
app.get('/status', (req, res) => {
    res.json({ 
        status: sock && sock.user ? 'connected' : 'disconnected',
        user: sock && sock.user ? sock.user.id : null
    });
});

app.listen(PORT, () => {
    console.log(`WhatsApp API rodando na porta ${PORT}`);
});

// Mantém o processo vivo em caso de erros não tratados
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception thrown:', error);
});
