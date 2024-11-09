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


const client = new Client(
      
    {restartOnAuthFail: true, 
         puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } });


app.get('/qr', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    io.emit('qr', qr);  
});


let isMessageListenerSet = false; // Flag to track listener setup

client.on('ready', () => {
    console.log('Client is ready!');
    if (!isMessageListenerSet) {
        setupMessageListener(); 
        isMessageListenerSet = true; 
    }
});


function setupMessageListener() {
  
client.on('message_create', async (message) => {
            if (message.from === client.info.wid._serialized) {
                return; 
            }
            const senderNumber = message.from;
            console.log(`Message received from: ${senderNumber}`);

            const messageBody = message.body;
            console.log(messageBody);
        
    
            if (message.type === 'location') {
                const { latitude, longitude } = message.location;
                console.log(`Received location: Latitude: ${latitude}, Longitude: ${longitude}`);
                await saveLocationToGoogleSheets(latitude, longitude);
                return; 
            }
        
            await saveMessageToGoogleSheets(senderNumber, messageBody);
            await handleResponse(message);
        });

}
    
    client.on('qr', qr => {
    // Generate QR code and send it to the frontend
    qrcode.generate(qr, { small: true });
    // Emit the QR code to the frontend
    io.emit('qr', qr); // Using Socket.IO to send QR code to the client
});



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

async function saveMessageToGoogleSheets(senderNumber, messageBody,) {
    try {
        const response = await fetch('https://script.google.com/macros/s/AKfycbyFzI3fywUiQ11gzDuJAIdwU2VaofG9BYf4CS14-n_5jZcKEzqjr4jp_hZiObVRoHm1/exec', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({sender: senderNumber, message: messageBody  }),
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
        
        // Check if the response is not empty
        if (data.response) {
            const reply = data.response.replace(/\\n/g, "\n");
            client.sendMessage(message.from, reply);
        }
        // If data.response is empty, do not send any message

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

    client.on('ready', () => {
    console.log('Client is ready!');
    if (!isMessageListenerSet) {
        setupMessageListener(); // Set up message listeners only once
        isMessageListenerSet = true; // Update the flag
    }
    });


});

