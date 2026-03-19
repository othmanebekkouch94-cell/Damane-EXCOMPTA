const express = require('express');
const { Op } = require('sequelize');
const { JournalEntry, JournalLine, ChartOfAccounts, sequelize } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/journal - Écritures comptables
router.get('/', authenticate, async (req, res) => {
  try {
    const { fiscalYear, period, journal, status, startDate, endDate, page = 1, limit = 50 } = req.query;
    const where = {};

    if (fiscalYear) where.fiscalYear = fiscalYear;
    if (period) where.period = period;
    if (journal) where.journal = journal;
    if (status) where.status = status;
    if (startDate && endDate) {
      where.entryDate = { [Op.between]: [startDate, endDate] };
    }

    const offset = (page - 1) * limit;
    const { rows, count } = await JournalEntry.findAndCountAll({
      where,
      include: [{
        model: JournalLine,
        as: 'lines',
        include: [{ model: ChartOfAccounts, as: 'account', attributes: ['accountNumber', 'accountName'] }],
      }],
      order: [['entryDate', 'DESC'], ['entryNumber', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    res.json({
      entries: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/journal - Créer une écriture
router.post('/', authenticate, authorize('admin', 'editor'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { entryDate, journal, reference, description, fiscalYear, period, lines } = req.body;

    // Vérifier équilibre débit = crédit
    const totalDebit = lines.reduce((sum, l) => sum + parseFloat(l.debit || 0), 0);
    const totalCredit = lines.reduce((sum, l) => sum + parseFloat(l.credit || 0), 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      await t.rollback();
      return res.status(400).json({
        error: `Écriture déséquilibrée : débit=${totalDebit.toFixed(2)}, crédit=${totalCredit.toFixed(2)}`,
      });
    }

    // Générer numéro d'écriture
    const lastEntry = await JournalEntry.findOne({
      where: { fiscalYear, journal },
      order: [['entryNumber', 'DESC']],
      transaction: t,
    });
    const seq = lastEntry ? parseInt(lastEntry.entryNumber.split('-').pop()) + 1 : 1;
    const entryNumber = `${journal}-${fiscalYear}-${String(seq).padStart(6, '0')}`;

    const entry = await JournalEntry.create({
      entryNumber,
      entryDate,
      journal,
      reference,
      description,
      fiscalYear,
      period,
      totalDebit,
      totalCredit,
      status: 'draft',
      createdBy: req.user.id,
    }, { transaction: t });

    const journalLines = lines.map((line) => ({
      ...line,
      journalEntryId: entry.id,
    }));
    await JournalLine.bulkCreate(journalLines, { transaction: t });

    await t.commit();

    const created = await JournalEntry.findByPk(entry.id, {
      include: [{
        model: JournalLine,
        as: 'lines',
        include: [{ model: ChartOfAccounts, as: 'account' }],
      }],
    });

    res.status(201).json({ entry: created });
  } catch (error) {
    await t.rollback();
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/journal/:id/post - Valider une écriture
router.put('/:id/post', authenticate, authorize('admin'), async (req, res) => {
  try {
    const entry = await JournalEntry.findByPk(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Écriture non trouvée' });
    if (entry.status !== 'draft') return res.status(400).json({ error: 'Seules les écritures brouillon peuvent être validées' });

    await entry.update({ status: 'posted' });
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/journal/grand-livre - Grand livre
router.get('/grand-livre', authenticate, async (req, res) => {
  try {
    const { accountId, fiscalYear, startDate, endDate } = req.query;

    const lineWhere = {};
    if (accountId) lineWhere.accountId = accountId;

    const entryWhere = { status: 'posted' };
    if (fiscalYear) entryWhere.fiscalYear = fiscalYear;
    if (startDate && endDate) {
      entryWhere.entryDate = { [Op.between]: [startDate, endDate] };
    }

    const lines = await JournalLine.findAll({
      where: lineWhere,
      include: [
        { model: JournalEntry, where: entryWhere, attributes: ['entryNumber', 'entryDate', 'journal', 'description'] },
        { model: ChartOfAccounts, as: 'account', attributes: ['accountNumber', 'accountName'] },
      ],
      order: [[JournalEntry, 'entryDate', 'ASC']],
    });

    // Grouper par compte
    const grandLivre = {};
    for (const line of lines) {
      const key = line.account.accountNumber;
      if (!grandLivre[key]) {
        grandLivre[key] = {
          accountNumber: line.account.accountNumber,
          accountName: line.account.accountName,
          lines: [],
          totalDebit: 0,
          totalCredit: 0,
        };
      }
      grandLivre[key].lines.push(line);
      grandLivre[key].totalDebit += parseFloat(line.debit);
      grandLivre[key].totalCredit += parseFloat(line.credit);
    }

    res.json({ grandLivre: Object.values(grandLivre) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/journal/balance - Balance générale
router.get('/balance', authenticate, async (req, res) => {
  try {
    const { fiscalYear } = req.query;

    const results = await JournalLine.findAll({
      attributes: [
        'accountId',
        [sequelize.fn('SUM', sequelize.col('debit')), 'totalDebit'],
        [sequelize.fn('SUM', sequelize.col('credit')), 'totalCredit'],
      ],
      include: [
        {
          model: JournalEntry,
          where: { status: 'posted', ...(fiscalYear && { fiscalYear }) },
          attributes: [],
        },
        {
          model: ChartOfAccounts,
          as: 'account',
          attributes: ['accountNumber', 'accountName', 'accountType', 'accountClass'],
        },
      ],
      group: ['JournalLine.accountId', 'account.id'],
      order: [[{ model: ChartOfAccounts, as: 'account' }, 'accountNumber', 'ASC']],
      raw: false,
    });

    const balance = results.map((r) => ({
      accountNumber: r.account.accountNumber,
      accountName: r.account.accountName,
      accountType: r.account.accountType,
      accountClass: r.account.accountClass,
      totalDebit: parseFloat(r.getDataValue('totalDebit')) || 0,
      totalCredit: parseFloat(r.getDataValue('totalCredit')) || 0,
      soldeDebit: Math.max(0, (parseFloat(r.getDataValue('totalDebit')) || 0) - (parseFloat(r.getDataValue('totalCredit')) || 0)),
      soldeCredit: Math.max(0, (parseFloat(r.getDataValue('totalCredit')) || 0) - (parseFloat(r.getDataValue('totalDebit')) || 0)),
    }));

    res.json({ balance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
