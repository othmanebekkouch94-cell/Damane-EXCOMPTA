const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const BankTransaction = sequelize.define('BankTransaction', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  bankAccount: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'IBAN ou identifiant compte bancaire',
  },
  transactionDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  valueDate: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  amount: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
  },
  balance: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,
  },
  type: {
    type: DataTypes.ENUM('credit', 'debit'),
    allowNull: false,
  },
  category: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Catégorie auto-détectée par IA',
  },
  reconciled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  journalEntryId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'journal_entries', key: 'id' },
    comment: 'Écriture comptable liée après rapprochement',
  },
  suggestedAccountId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'chart_of_accounts', key: 'id' },
    comment: 'Compte suggéré par IA',
  },
  sourceFile: {
    type: DataTypes.STRING,
    allowNull: true,
  },
}, {
  tableName: 'bank_transactions',
  timestamps: true,
  indexes: [
    { fields: ['transactionDate'] },
    { fields: ['bankAccount'] },
    { fields: ['reconciled'] },
    { fields: ['category'] },
  ],
});

module.exports = BankTransaction;
