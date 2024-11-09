import fetch from 'node-fetch';
import qrcode from 'qrcode-terminal';
import { Client } from 'whatsapp-web.js';
import express from 'express';
import path from 'path';
import http from 'http';
import { Server } from 'socket.io';
import puppeteer from 'puppeteer-core';  

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'] 
});

const PORT = process.env.PORT || 7000; 
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

app.use(express.json());
app.use(express.static('public')); 

app.post('/sendMessage', async (req, res) => {
    const { number, message } = req.body;
    try {
        await sendMessageToNumber(number, message);
        res.status(200).send({ result: 'Message sent' });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).send({ error: 'Failed to send message' });
    }
});

// Endpoint to get QR code
app.get('/qr', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const client = new Client(
      
    {restartOnAuthFail: true, 
         puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } });


let isMessageListenerSet = false; // Flag to track listener setup

client.on('ready', () => {
    console.log('Client is ready!');
    if (!isMessageListenerSet) {
        setupMessageListener(); // Set up message listeners only once
        isMessageListenerSet = true; // Update the flag
    }
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    io.emit('qr', qr);  
});

client.on('authenticated', () => {
    console.log('Client authenticated');
    if (!isMessageListenerSet) {
        setupMessageListener(); // Set up listeners only if not already set
        isMessageListenerSet = true; // Update the flag
    }
});

client.on('auth_failure', () => {
    console.error('Authentication failed, please check your QR code and try again.');
});

function setupMessageListener() {
    client.on('message_create', async (message) => {
        if (message.from === client.info.wid._serialized) {
            return; 
        }

        const messageBody = message.body;
        console.log(messageBody);

        if (message.type === 'location') {
            const { latitude, longitude } = message.location;
            console.log(`Received location: Latitude: ${latitude}, Longitude: ${longitude}`);
            await saveLocationToGoogleSheets(latitude, longitude);
            return; 
        }

        await saveMessageToGoogleSheets(messageBody);
        await handleResponse(message);
    });
}

async function saveLocationToGoogleSheets(latitude, longitude) {
    try {
        const response = await fetch('https://script.google.com/macros/s/AKfycbyFzI3fywUiQ11gzDuJAIdwU2VaofG9BYf4CS14-n_5jZcKEzqjr4jp_hZiObVRoHm1/exec', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude, longitude }),
        });
        const data = await response.json();
        console.log('Location saved to Google Sheets:', data);
    } catch (error) {
        console.error('Error saving location:', error);
    }
}

async function saveMessageToGoogleSheets(messageBody) {
    try {
        const response = await fetch('https://script.google.com/macros/s/AKfycbyFzI3fywUiQ11gzDuJAIdwU2VaofG9BYf4CS14-n_5jZcKEzqjr4jp_hZiObVRoHm1/exec', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: messageBody }),
        });
        const data = await response.json();
        console.log('Message saved to Google Sheets:', data);
    } catch (error) {
        console.error('Error saving message:', error);
    }
}

async function handleResponse(message) {
    const msgBody = message.body.toLowerCase();
    try {
        const response = await fetch('https://script.google.com/macros/s/AKfycbyFzI3fywUiQ11gzDuJAIdwU2VaofG9BYf4CS14-n_5jZcKEzqjr4jp_hZiObVRoHm1/exec?query=' + encodeURIComponent(msgBody));
        const data = await response.json();
        const reply = data.response ? data.response.replace(/\\n/g, "\n") : 'Hello, how can I assist you?';
        client.sendMessage(message.from, reply);
    } catch (error) {
        console.error('Error fetching response:', error);
        client.sendMessage(message.from, 'Sorry, I could not process your request.');
    }
}

async function sendMessageToNumber(number, message) {
    try {
        const chatId = `${number}@c.us`; // WhatsApp chat ID format
        await client.sendMessage(chatId, message);
    } catch (error) {
        console.error('Error sending message:', error);
        throw new Error('Failed to send message'); // Rethrow the error for further handling
    }
}

// Initialize the client
client.initialize();

client.on('disconnected', async (reason) => {
    console.log('Client was logged out:', reason);
    await client.destroy(); // Properly destroy the client instance
    await client.initialize(); // Re-initialize the client

    // Re-establish the QR code listener
    client.on('qr', qr => {
        qrcode.generate(qr, { small: true });
        io.emit('qr', qr);  
    });

    // Optionally, you can also set up the message listener again
    if (!isMessageListenerSet) {
        setupMessageListener(); // Set up listeners again if not already set
        isMessageListenerSet = true; // Update the flag
    }
});

