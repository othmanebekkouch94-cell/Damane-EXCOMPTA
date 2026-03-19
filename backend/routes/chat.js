const express = require('express');
const { authenticate } = require('../middleware/auth');
const aiChatService = require('../services/aiChatService');

const router = express.Router();

// POST /api/chat - Envoyer un message au chatbot IA
router.post('/', authenticate, async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message requis' });
    }

    const response = await aiChatService.chat(message, conversationHistory, req.user);
    res.json({ response });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/chat/analyze - Analyser un document via IA
router.post('/analyze', authenticate, async (req, res) => {
  try {
    const { documentId, question } = req.body;
    const analysis = await aiChatService.analyzeDocument(documentId, question);
    res.json({ analysis });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
