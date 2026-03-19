const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ChartOfAccounts = sequelize.define('ChartOfAccounts', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  accountNumber: {
    type: DataTypes.STRING(20),
    allowNull: false,
    unique: true,
  },
  accountName: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  accountType: {
    type: DataTypes.ENUM(
      'actif',           // Classe 1-5 Actif
      'passif',          // Classe 1-5 Passif
      'charge',          // Classe 6
      'produit',         // Classe 7
      'resultat'         // Classe 8
    ),
    allowNull: false,
  },
  accountClass: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 9 },
    comment: 'Classe PCG : 1=Capitaux, 2=Immobilisations, 3=Stocks, 4=Tiers, 5=Financier, 6=Charges, 7=Produits',
  },
  parentAccountId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'chart_of_accounts', key: 'id' },
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  normalBalance: {
    type: DataTypes.ENUM('debit', 'credit'),
    allowNull: false,
  },
}, {
  tableName: 'chart_of_accounts',
  timestamps: true,
  indexes: [
    { fields: ['accountNumber'] },
    { fields: ['accountClass'] },
    { fields: ['accountType'] },
  ],
});

ChartOfAccounts.hasMany(ChartOfAccounts, { as: 'children', foreignKey: 'parentAccountId' });
ChartOfAccounts.belongsTo(ChartOfAccounts, { as: 'parent', foreignKey: 'parentAccountId' });

module.exports = ChartOfAccounts;
