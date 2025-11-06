const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const pino = require('pino');
const dotenv = require('dotenv');
const qrcode = require('qrcode'); // Para gerar Base64
const qrcodeTerminal = require('qrcode-terminal'); // Para logs

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

let sock;
let qrCodeData = null; // Variável para armazenar o QR Code

// Função para iniciar a conexão com o WhatsApp
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada:', lastDisconnect.error, ', reconectando:', shouldReconnect);
            qrCodeData = null; // Limpa o QR Code ao desconectar
            if (shouldReconnect) {
                setTimeout(connectToWhatsApp, 5000);
            }
        } else if (connection === 'open') {
            console.log('Conexão aberta com sucesso!');
            qrCodeData = null; // Limpa o QR Code ao conectar
        }
        
        if (qr) {
            // Armazena o QR Code para o endpoint /qr
            qrCodeData = qr;
            // Imprime no log para facilitar a visualização inicial
            qrcodeTerminal.generate(qr, { small: true });
            console.log('QR Code gerado. Acesse /qr para ver a imagem.');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Inicia a conexão
connectToWhatsApp().catch(err => console.error("Erro inicial ao conectar ao WhatsApp:", err));

// Rota para Health Check do Coolify
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: sock && sock.user ? 'connected' : 'disconnected',
        message: 'WhatsApp API is running.' 
    });
});

// NOVO ENDPOINT: Exibe o QR Code como imagem
app.get('/qr', async (req, res) => {
    if (sock && sock.user) {
        return res.status(200).json({ status: 'connected', message: 'Already connected.' });
    }
    
    if (qrCodeData) {
        try {
            const qrImage = await qrcode.toDataURL(qrCodeData);
            // Retorna a imagem Base64
            return res.status(200).json({ status: 'scan_required', qr_code: qrImage });
        } catch (e) {
            console.error('Erro ao gerar QR Code:', e);
            return res.status(500).json({ status: 'error', message: 'Failed to generate QR Code image.' });
        }
    }
    
    res.status(200).json({ status: 'connecting', message: 'Waiting for QR Code generation.' });
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
