const { Client } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
require("dotenv").config();

// Initialize WhatsApp and Gemini AI
const client = new Client();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Load previous chat history
let chatHistory = {};
const historyFile = "chat_history.json";

if (fs.existsSync(historyFile)) {
    chatHistory = JSON.parse(fs.readFileSync(historyFile));
}

client.on("qr", (qr) => {
    console.log("Scan this QR code with your WhatsApp:");
    qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
    console.log("✅ WhatsApp bot is ready!");
});

client.on("message", async (message) => {
    console.log(`📩 Received: ${message.body}`);

    const userId = message.from;

    // Fetch all messages if the user chats for the first time
    if (!chatHistory[userId]) {
        console.log("📜 Fetching all past messages...");
        chatHistory[userId] = await fetchOldMessages(userId, 51); // Fetch 51 to ensure we get enough context
    }

    // Fetch the last 10 messages
    const lastMessages = await fetchOldMessages(userId, 10);

    // Merge without duplicates
    const uniqueMessages = new Map();
    [...chatHistory[userId], ...lastMessages].forEach((msg) => {
        uniqueMessages.set(msg.id, msg); // Store unique messages by ID
    });

    // Update history
    chatHistory[userId] = Array.from(uniqueMessages.values());

    // Store new user message
    chatHistory[userId].push({ role: "user", text: message.body });

    // Generate AI response using full chat history
    const response = await getAIResponse(userId);

    // Store AI response
    chatHistory[userId].push({ role: "assistant", text: response });

    // Save updated chat history
    fs.writeFileSync(historyFile, JSON.stringify(chatHistory, null, 2));

    client.sendMessage(userId, response);
});

client.on("disconnected", (reason) => {
    console.log(`❌ Disconnected: ${reason}`);
});

async function fetchOldMessages(userId, fetchLimit) {
    try {
        const chat = await client.getChatById(userId);
        let allMessages = [];
        let lastMessage = null;

        while (fetchLimit > 0) {
            const messages = await chat.fetchMessages({
                limit: Math.min(fetchLimit, 50), // Fetch 50 messages at a time
                before: lastMessage ? lastMessage.id._serialized : undefined,
            });

            if (messages.length === 0) break; // Stop when no more messages

            allMessages = [...messages, ...allMessages];
            lastMessage = messages[0]; // Store last message for next batch
            fetchLimit -= messages.length; // Reduce remaining fetch count
        }

        console.log(`✅ Fetched ${allMessages.length} messages for ${userId}`);

        return allMessages.map((msg) => ({
            id: msg.id._serialized,
            role: msg.fromMe ? "assistant" : "user",
            text: msg.body,
        }));
    } catch (error) {
        console.error("❌ Error fetching messages:", error);
        return [];
    }
}

async function getAIResponse(userId) {
    try {
        const conversation = chatHistory[userId].map((msg) => msg.text).join("\n");
        const result = await model.generateContent(`Remember our past conversation: ${conversation} and the way I communicate. Respond in the same language and style as my last message, whether it's English, Hinglish, or any other language. Be polite and respectful in your response.
        If a past conversation exists, continue from where we left off while maintaining the same tone.  
        If no conversation history exists, start with a warm and friendly greeting before responding to my message.
        Do not repeat any of my messages in any situation. Ensure that responses are unique and relevant to the ongoing conversation.`);
        return result.response.text();
    } catch (error) {
        console.error("❌ Error:", error);
        return "Sorry, I'm having trouble responding right now.";
    }
}

// Start WhatsApp bot
client.initialize();