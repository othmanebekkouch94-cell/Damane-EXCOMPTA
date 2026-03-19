const express = require('express');
const { Op } = require('sequelize');
const { BankTransaction, ChartOfAccounts, JournalEntry, JournalLine, sequelize } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/bank - Transactions bancaires
router.get('/', authenticate, async (req, res) => {
  try {
    const { bankAccount, reconciled, startDate, endDate, page = 1, limit = 50 } = req.query;
    const where = {};

    if (bankAccount) where.bankAccount = bankAccount;
    if (reconciled !== undefined) where.reconciled = reconciled === 'true';
    if (startDate && endDate) {
      where.transactionDate = { [Op.between]: [startDate, endDate] };
    }

    const offset = (page - 1) * limit;
    const { rows, count } = await BankTransaction.findAndCountAll({
      where,
      include: [
        { model: ChartOfAccounts, as: 'suggestedAccount', attributes: ['accountNumber', 'accountName'], required: false },
      ],
      order: [['transactionDate', 'DESC']],
      limit: parseInt(limit),
      offset,
    });

    res.json({
      transactions: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/bank/import - Import relevé bancaire CSV
router.post('/import', authenticate, authorize('admin', 'editor'), async (req, res) => {
  try {
    const { transactions, bankAccount } = req.body;

    const created = [];
    for (const tx of transactions) {
      const bankTx = await BankTransaction.create({
        bankAccount,
        transactionDate: tx.date,
        valueDate: tx.valueDate || tx.date,
        description: tx.description,
        amount: Math.abs(tx.amount),
        type: tx.amount >= 0 ? 'credit' : 'debit',
        sourceFile: tx.sourceFile || null,
      });
      created.push(bankTx);
    }

    res.status(201).json({
      message: `${created.length} transactions importées`,
      transactions: created,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/bank/:id/reconcile - Rapprocher une transaction
router.post('/:id/reconcile', authenticate, authorize('admin', 'editor'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { accountId } = req.body;
    const bankTx = await BankTransaction.findByPk(req.params.id, { transaction: t });
    if (!bankTx) {
      await t.rollback();
      return res.status(404).json({ error: 'Transaction non trouvée' });
    }

    const account = await ChartOfAccounts.findByPk(accountId, { transaction: t });
    if (!account) {
      await t.rollback();
      return res.status(404).json({ error: 'Compte non trouvé' });
    }

    // Trouver le compte banque (512xxx)
    const bankAccountObj = await ChartOfAccounts.findOne({
      where: { accountNumber: { [Op.like]: '512%' } },
      transaction: t,
    });

    if (!bankAccountObj) {
      await t.rollback();
      return res.status(400).json({ error: 'Compte bancaire 512xxx non trouvé dans le plan comptable' });
    }

    // Créer l'écriture comptable
    const date = new Date(bankTx.transactionDate);
    const fiscalYear = date.getFullYear();
    const period = date.getMonth() + 1;

    const lastEntry = await JournalEntry.findOne({
      where: { fiscalYear, journal: 'BA' },
      order: [['entryNumber', 'DESC']],
      transaction: t,
    });
    const seq = lastEntry ? parseInt(lastEntry.entryNumber.split('-').pop()) + 1 : 1;
    const entryNumber = `BA-${fiscalYear}-${String(seq).padStart(6, '0')}`;

    const entry = await JournalEntry.create({
      entryNumber,
      entryDate: bankTx.transactionDate,
      journal: 'BA',
      reference: bankTx.description.substring(0, 100),
      description: bankTx.description,
      fiscalYear,
      period,
      totalDebit: bankTx.amount,
      totalCredit: bankTx.amount,
      status: 'posted',
      createdBy: req.user.id,
    }, { transaction: t });

    const lines = bankTx.type === 'debit'
      ? [
          { journalEntryId: entry.id, accountId: account.id, debit: bankTx.amount, credit: 0, label: bankTx.description },
          { journalEntryId: entry.id, accountId: bankAccountObj.id, debit: 0, credit: bankTx.amount, label: bankTx.description },
        ]
      : [
          { journalEntryId: entry.id, accountId: bankAccountObj.id, debit: bankTx.amount, credit: 0, label: bankTx.description },
          { journalEntryId: entry.id, accountId: account.id, debit: 0, credit: bankTx.amount, label: bankTx.description },
        ];

    await JournalLine.bulkCreate(lines, { transaction: t });

    await bankTx.update({
      reconciled: true,
      journalEntryId: entry.id,
      suggestedAccountId: accountId,
    }, { transaction: t });

    await t.commit();
    res.json({ message: 'Transaction rapprochée', bankTransaction: bankTx, journalEntry: entry });
  } catch (error) {
    await t.rollback();
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
