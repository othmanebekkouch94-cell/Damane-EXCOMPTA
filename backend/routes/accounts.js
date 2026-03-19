const express = require('express');
const { Op } = require('sequelize');
const { ChartOfAccounts } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/accounts - Liste du plan comptable
router.get('/', authenticate, async (req, res) => {
  try {
    const { accountClass, accountType, search } = req.query;
    const where = { isActive: true };

    if (accountClass) where.accountClass = accountClass;
    if (accountType) where.accountType = accountType;
    if (search) {
      where[Op.or] = [
        { accountNumber: { [Op.iLike]: `%${search}%` } },
        { accountName: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const accounts = await ChartOfAccounts.findAll({
      where,
      order: [['accountNumber', 'ASC']],
      include: [{ model: ChartOfAccounts, as: 'children', required: false }],
    });

    res.json({ accounts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/accounts - Créer un compte
router.post('/', authenticate, authorize('admin', 'editor'), async (req, res) => {
  try {
    const account = await ChartOfAccounts.create(req.body);
    res.status(201).json({ account });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/accounts/:id
router.put('/:id', authenticate, authorize('admin', 'editor'), async (req, res) => {
  try {
    const account = await ChartOfAccounts.findByPk(req.params.id);
    if (!account) return res.status(404).json({ error: 'Compte non trouvé' });

    await account.update(req.body);
    res.json({ account });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/accounts/import - Import massif du plan comptable
router.post('/import', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { accounts } = req.body;
    const created = await ChartOfAccounts.bulkCreate(accounts, { ignoreDuplicates: true });
    res.status(201).json({ message: `${created.length} comptes importés`, count: created.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
