const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { sequelize } = require('./models');
const seed = require('./seed');

// Routes
const authRoutes = require('./routes/auth');
const accountsRoutes = require('./routes/accounts');
const journalRoutes = require('./routes/journal');
const documentsRoutes = require('./routes/documents');
const reportsRoutes = require('./routes/reports');
const bankRoutes = require('./routes/bank');
const chatRoutes = require('./routes/chat');
const invoicesRoutes = require('./routes/invoices');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Créer le dossier uploads
const uploadsDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/invoices', invoicesRoutes);

// Serve frontend en production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/build/index.html'));
  });
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// Error handler
app.use((err, req, res, _next) => {
  console.error('Error:', err.message);
  if (err.name === 'MulterError') {
    return res.status(400).json({ error: `Erreur upload: ${err.message}` });
  }
  res.status(err.status || 500).json({ error: err.message || 'Erreur serveur interne' });
});

// Start
async function start() {
  try {
    await sequelize.authenticate();
    console.log('Base de données connectée.');

    // Sync models - crée les tables manquantes sans modifier l'existant
    await sequelize.sync({ force: false });
    console.log('Modèles synchronisés.');

    // Seed default users on first start
    await seed();

    app.listen(PORT, () => {
      console.log(`\n  DAMANE Expert-Comptable API`);
      console.log(`  ──────────────────────────`);
      console.log(`  Serveur démarré sur http://localhost:${PORT}`);
      console.log(`  Environnement: ${process.env.NODE_ENV || 'development'}\n`);
    });
  } catch (error) {
    console.error('Erreur de démarrage:', error.message);
    process.exit(1);
  }
}

start();

module.exports = app;
