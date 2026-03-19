const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Document } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');
const documentParser = require('../services/documentParser');

const router = express.Router();

// Config multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.UPLOAD_DIR || './uploads');
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 50000000 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.xlsx', '.xls', '.csv', '.jpg', '.jpeg', '.png'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Format non supporté: ${ext}. Formats acceptés: ${allowed.join(', ')}`));
    }
  },
});

// POST /api/documents/upload - Upload document
router.post('/upload', authenticate, authorize('admin', 'editor'), upload.array('files', 20), async (req, res) => {
  try {
    const { documentType, fiscalYear } = req.body;
    const documents = [];

    for (const file of req.files) {
      const doc = await Document.create({
        originalName: file.originalname,
        storedPath: file.path,
        mimeType: file.mimetype,
        fileSize: file.size,
        documentType: documentType || 'autre',
        fiscalYear: fiscalYear ? parseInt(fiscalYear) : null,
        uploadedBy: req.user.id,
        processingStatus: 'pending',
      });
      documents.push(doc);
    }

    // Lancer le parsing en arrière-plan
    for (const doc of documents) {
      documentParser.processDocument(doc.id).catch((err) => {
        console.error(`Erreur parsing document ${doc.id}:`, err);
      });
    }

    res.status(201).json({
      message: `${documents.length} document(s) uploadé(s)`,
      documents,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/documents - Liste documents
router.get('/', authenticate, async (req, res) => {
  try {
    const { documentType, fiscalYear, status, page = 1, limit = 20 } = req.query;
    const where = {};

    if (documentType) where.documentType = documentType;
    if (fiscalYear) where.fiscalYear = fiscalYear;
    if (status) where.processingStatus = status;

    const offset = (page - 1) * limit;
    const { rows, count } = await Document.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    res.json({
      documents: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/documents/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const doc = await Document.findByPk(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document non trouvé' });
    res.json({ document: doc });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/documents/:id/reprocess - Relancer le parsing
router.post('/:id/reprocess', authenticate, authorize('admin'), async (req, res) => {
  try {
    const doc = await Document.findByPk(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document non trouvé' });

    await doc.update({ processingStatus: 'pending', processingError: null });
    documentParser.processDocument(doc.id).catch((err) => {
      console.error(`Erreur reprocessing ${doc.id}:`, err);
    });

    res.json({ message: 'Retraitement lancé', document: doc });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
