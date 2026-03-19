const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const JournalEntry = sequelize.define('JournalEntry', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  entryNumber: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  entryDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
  },
  journal: {
    type: DataTypes.ENUM('AC', 'VE', 'BA', 'OD', 'AN', 'CL'),
    allowNull: false,
    comment: 'AC=Achats, VE=Ventes, BA=Banque, OD=Opérations Diverses, AN=A-Nouveau, CL=Clôture',
  },
  reference: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Numéro facture, chèque, etc.',
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('draft', 'posted', 'cancelled'),
    defaultValue: 'draft',
  },
  totalDebit: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0,
  },
  totalCredit: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0,
  },
  fiscalYear: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  period: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 12 },
  },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  sourceDocument: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Chemin du document source (facture, relevé, etc.)',
  },
}, {
  tableName: 'journal_entries',
  timestamps: true,
  indexes: [
    { fields: ['entryDate'] },
    { fields: ['journal'] },
    { fields: ['fiscalYear', 'period'] },
    { fields: ['status'] },
  ],
});

const JournalLine = sequelize.define('JournalLine', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  journalEntryId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'journal_entries', key: 'id' },
  },
  accountId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'chart_of_accounts', key: 'id' },
  },
  debit: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0,
  },
  credit: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0,
  },
  label: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  thirdParty: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Client/Fournisseur/Salarié',
  },
}, {
  tableName: 'journal_lines',
  timestamps: true,
  indexes: [
    { fields: ['journalEntryId'] },
    { fields: ['accountId'] },
  ],
});

JournalEntry.hasMany(JournalLine, { as: 'lines', foreignKey: 'journalEntryId', onDelete: 'CASCADE' });
JournalLine.belongsTo(JournalEntry, { foreignKey: 'journalEntryId' });

module.exports = { JournalEntry, JournalLine };
