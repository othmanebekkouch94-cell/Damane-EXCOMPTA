const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate: auth } = require('../middleware/auth');
const zipProcessor = require('../services/zipProcessor');

// Configure multer for ZIP uploads (500MB max)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'zips');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.zip') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers ZIP sont acceptés'));
    }
  },
});

// Store processing progress in memory
const progressStore = {};

// Persister le manifest sur disque pour survivre aux redémarrages
const EXTRACT_BASE = path.join(__dirname, '..', 'uploads', 'extracted');
function saveManifest(jobId, extractDir) {
  try {
    if (!fs.existsSync(EXTRACT_BASE)) fs.mkdirSync(EXTRACT_BASE, { recursive: true });
    const manifestPath = path.join(EXTRACT_BASE, `${jobId}.json`);
    fs.writeFileSync(manifestPath, JSON.stringify({ jobId, extractDir, createdAt: new Date().toISOString() }));
  } catch (e) { /* ignore */ }
}
function loadManifest(jobId) {
  try {
    const manifestPath = path.join(EXTRACT_BASE, `${jobId}.json`);
    if (fs.existsSync(manifestPath)) {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return null;
}
function getExtractDir(jobId) {
  // D'abord chercher en mémoire
  if (progressStore[jobId]?.extractDir) return progressStore[jobId].extractDir;
  // Puis sur disque
  const manifest = loadManifest(jobId);
  if (manifest?.extractDir && fs.existsSync(manifest.extractDir)) return manifest.extractDir;
  // Fallback : le dossier par convention
  const dir = path.join(EXTRACT_BASE, jobId);
  if (fs.existsSync(dir)) return dir;
  return null;
}

// POST /api/invoices/upload-zip - Upload and process a ZIP file
router.post('/upload-zip', auth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier ZIP fourni' });
  }

  const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  // Initialize progress
  progressStore[jobId] = {
    status: 'processing',
    progress: 0,
    message: 'Démarrage...',
    startTime: Date.now(),
    fileName: req.file.originalname,
    fileSize: req.file.size,
  };

  // Start processing in background
  processZipAsync(jobId, req.file.path, req.file.originalname);

  res.json({
    jobId,
    message: 'Traitement démarré',
    fileName: req.file.originalname,
    fileSize: req.file.size,
  });
});

// Async ZIP processing
async function processZipAsync(jobId, filePath, originalName) {
  try {
    // Créer un dossier pour stocker les fichiers extraits
    const extractDir = path.join(__dirname, '..', 'uploads', 'extracted', jobId);
    if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true });

    // Extraire tous les fichiers du ZIP pour la visualisation
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(filePath);
    zip.extractAllTo(extractDir, true);

    // Persister le manifest sur disque
    saveManifest(jobId, extractDir);

    const report = await zipProcessor.processZip(filePath, (progress, message) => {
      progressStore[jobId] = {
        ...progressStore[jobId],
        progress,
        message,
      };
    });

    // Générer les écritures comptables PCG pour chaque facture
    report.invoices.forEach((inv, idx) => {
      inv.id = `${jobId}_inv_${idx}`;
      inv.ecritures = generateEcrituresPCG(inv);
    });

    progressStore[jobId] = {
      ...progressStore[jobId],
      status: 'completed',
      progress: 100,
      message: 'Traitement terminé',
      report,
      extractDir,
    };

    // Clean up ZIP file (garder les extraits)
    try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
  } catch (error) {
    progressStore[jobId] = {
      ...progressStore[jobId],
      status: 'error',
      progress: 0,
      message: error.message,
      error: error.message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GÉNÉRATION DES ÉCRITURES COMPTABLES — PCG FRANÇAIS
// ═══════════════════════════════════════════════════════════════════════════
function generateEcrituresPCG(invoice) {
  const ecritures = [];
  const date = invoice.date || new Date().toLocaleDateString('fr-FR');
  const label = `${invoice.supplier || 'Fournisseur'} - Fact. ${invoice.invoiceNumber || 'N/A'}`;
  const ht = invoice.totalHT || 0;
  const tva = invoice.totalTVA || 0;
  const ttc = invoice.totalTTC || invoice.totalAmount || 0;

  if (ttc <= 0) return ecritures;

  // ── ACHAT FOURNISSEUR (schéma standard PCG) ────────────────────────────
  // Débit : 6XX (charges) pour le HT
  // Débit : 44566 (TVA déductible) pour la TVA
  // Crédit : 401 (fournisseur) pour le TTC

  // Déterminer le compte de charge en fonction du fournisseur/nature
  const compteCharge = determineCompteCharge(invoice);

  if (ht > 0) {
    // Écriture standard avec HT + TVA
    ecritures.push({
      compte: compteCharge.numero,
      libelle: compteCharge.libelle,
      description: label,
      debit: ht,
      credit: 0,
      date,
    });

    if (tva > 0) {
      ecritures.push({
        compte: '44566',
        libelle: 'TVA déductible sur ABS',
        description: label,
        debit: tva,
        credit: 0,
        date,
      });
    }

    ecritures.push({
      compte: '401',
      libelle: `Fournisseur ${invoice.supplier || ''}`.trim(),
      description: label,
      debit: 0,
      credit: ttc || (ht + tva),
      date,
    });
  } else {
    // Seulement TTC disponible — on écrit avec TTC directement
    ecritures.push({
      compte: compteCharge.numero,
      libelle: compteCharge.libelle,
      description: label,
      debit: ttc,
      credit: 0,
      date,
    });

    ecritures.push({
      compte: '401',
      libelle: `Fournisseur ${invoice.supplier || ''}`.trim(),
      description: label,
      debit: 0,
      credit: ttc,
      date,
    });
  }

  return ecritures;
}

function determineCompteCharge(invoice) {
  const supplier = (invoice.supplier || '').toLowerCase();
  const fileName = (invoice.fileName || '').toLowerCase();
  const combined = supplier + ' ' + fileName;

  // Télécommunications / Internet
  if (combined.match(/orange|sfr|bouygues|free|telecom|internet|fibre|mobile|phone/))
    return { numero: '626', libelle: 'Frais postaux et télécommunications' };

  // Énergie
  if (combined.match(/edf|engie|total.?energies?|gaz|electricit|énergie/))
    return { numero: '6061', libelle: 'Fournitures non stockables (eau, énergie)' };

  // Loyer / Immobilier
  if (combined.match(/loyer|bail|immobil|foncier|location/))
    return { numero: '613', libelle: 'Locations' };

  // Assurance
  if (combined.match(/axa|allianz|maif|maaf|assurance|mutuelle|generali|groupama/))
    return { numero: '616', libelle: 'Primes d\'assurance' };

  // Transport / Carburant
  if (combined.match(/sncf|air.france|transport|carburant|essence|gasoil|peage|autoroute|parking/))
    return { numero: '6251', libelle: 'Voyages et déplacements' };

  // Véhicule
  if (combined.match(/renault|peugeot|citroen|volkswagen|bmw|garage|entretien.v[eé]hicul/))
    return { numero: '6155', libelle: 'Entretien matériel de transport' };

  // Informatique / Logiciel
  if (combined.match(/amazon|apple|google|microsoft|adobe|ovh|ionos|software|logiciel|cloud|saas|hosting/))
    return { numero: '6156', libelle: 'Maintenance et logiciels' };

  // Banque
  if (combined.match(/banque|bnp|societe.generale|credit.agricole|lcl|caisse.d.epargne|frais.bancair/))
    return { numero: '627', libelle: 'Services bancaires et assimilés' };

  // Comptabilité / Juridique
  if (combined.match(/expert.comptable|avocat|notaire|juridique|audit|commissaire|conseil/))
    return { numero: '6226', libelle: 'Honoraires comptables et juridiques' };

  // Publicité
  if (combined.match(/pub|marketing|communication|affichage|campagne|google.ads|meta.ads|facebook/))
    return { numero: '623', libelle: 'Publicité, publications, relations publiques' };

  // Fournitures de bureau
  if (combined.match(/fourniture|bureau|papeterie|cartouche|imprimante|staples/))
    return { numero: '6064', libelle: 'Fournitures administratives' };

  // Restaurant / Réception
  if (combined.match(/restaurant|traiteur|repas|r[eé]ception|hotel|h[eé]bergement/))
    return { numero: '6257', libelle: 'Réceptions et hébergements' };

  // Sous-traitance
  if (combined.match(/sous.trait|prestation|freelance|intervenants/))
    return { numero: '611', libelle: 'Sous-traitance générale' };

  // Achat marchandises (par défaut si rien ne colle)
  return { numero: '607', libelle: 'Achats de marchandises' };
}

// GET /api/invoices/progress/:jobId - Check processing progress
router.get('/progress/:jobId', auth, (req, res) => {
  const job = progressStore[req.params.jobId];
  if (!job) {
    return res.status(404).json({ error: 'Job non trouvé' });
  }
  res.json(job);
});

// GET /api/invoices/report/:jobId - Get the full report
router.get('/report/:jobId', auth, (req, res) => {
  const job = progressStore[req.params.jobId];
  if (!job) {
    return res.status(404).json({ error: 'Job non trouvé' });
  }
  if (job.status !== 'completed') {
    return res.status(202).json({ status: job.status, progress: job.progress, message: job.message });
  }
  res.json(job.report);
});

// POST /api/invoices/upload-single - Upload and process a single invoice (PDF/Excel)
router.post('/upload-single', auth, multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
}).single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier fourni' });
  }

  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    const buffer = fs.readFileSync(req.file.path);

    let text = '';
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const result = await pdfParse(buffer);
      text = result.text;
    } else if (['.xlsx', '.xls'].includes(ext)) {
      const XLSX = require('xlsx');
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const rows = [];
      for (const name of wb.SheetNames) {
        rows.push(...XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' }));
      }
      text = rows.map(r => Object.values(r).join(' | ')).join('\n');
    } else if (ext === '.csv') {
      text = buffer.toString('utf-8');
    }

    const invoiceData = zipProcessor.extractInvoiceData(text, req.file.originalname);
    invoiceData.fileName = req.file.originalname;

    // Clean up
    try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }

    res.json(invoiceData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Recherche récursive d'un fichier par nom dans un dossier
function findFileRecursive(dir, targetName, maxDepth = 5) {
  if (maxDepth <= 0) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === targetName) return fullPath;
      if (entry.isDirectory()) {
        const found = findFileRecursive(fullPath, targetName, maxDepth - 1);
        if (found) return found;
      }
    }
  } catch (e) { /* ignore permission errors */ }
  return null;
}

// GET /api/invoices/file/:jobId/:rest - Servir un fichier extrait pour visualisation
// NOTE: Auth via query param ?token= car les iframes ne peuvent pas envoyer de headers
router.get('/file/:jobId/:rest', (req, res, next) => {
  // Accepter le token en query param OU en header
  if (req.query.token && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  auth(req, res, next);
}, (req, res) => {
  const extractDir = getExtractDir(req.params.jobId);
  if (!extractDir) {
    return res.status(404).json({ error: 'Job ou fichier non trouvé. Veuillez re-uploader le ZIP.' });
  }

  // Le reste du chemin après le jobId (normaliser les séparateurs)
  const filePath = decodeURIComponent(req.params[0]).replace(/\\/g, '/');
  const fullPath = path.join(extractDir, filePath);

  // Sécurité : vérifier que le fichier est bien dans le dossier extrait
  const resolved = path.resolve(fullPath);
  const resolvedDir = path.resolve(extractDir);
  if (!resolved.startsWith(resolvedDir)) {
    return res.status(403).json({ error: 'Accès interdit' });
  }

  if (!fs.existsSync(fullPath)) {
    // Fuzzy search : chercher le fichier par son nom dans tout le dossier extrait
    const targetName = path.basename(filePath);
    const found = findFileRecursive(extractDir, targetName);
    if (found) {
      const resolvedFound = path.resolve(found);
      if (resolvedFound.startsWith(resolvedDir)) {
        const ext2 = path.extname(found).toLowerCase();
        const mimeTypes2 = { '.pdf': 'application/pdf', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
        res.setHeader('Content-Type', mimeTypes2[ext2] || 'application/octet-stream');
        const safeName = encodeURIComponent(path.basename(found));
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${safeName}`);
        return res.sendFile(resolvedFound);
      }
    }
    return res.status(404).json({ error: 'Fichier non trouvé' });
  }

  // Déterminer le Content-Type
  const ext = path.extname(fullPath).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
  };

  res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
  // Encoder le filename pour les headers HTTP (les caractères non-ASCII comme € cassent les headers)
  const safeFilename = encodeURIComponent(path.basename(fullPath));
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${safeFilename}`);
  res.sendFile(resolved);
});

module.exports = router;
