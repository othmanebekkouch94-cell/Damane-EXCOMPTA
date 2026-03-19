const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Document = sequelize.define('Document', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  originalName: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  storedPath: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  mimeType: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  fileSize: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  documentType: {
    type: DataTypes.ENUM(
      'facture_achat',
      'facture_vente',
      'releve_bancaire',
      'grand_livre',
      'bilan',
      'compte_resultat',
      'plan_comptable',
      'bulletin_paie',
      'declaration_fiscale',
      'autre'
    ),
    defaultValue: 'autre',
  },
  ocrText: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Texte extrait par OCR',
  },
  parsedData: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Données structurées extraites',
  },
  processingStatus: {
    type: DataTypes.ENUM('pending', 'processing', 'completed', 'error'),
    defaultValue: 'pending',
  },
  processingError: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  uploadedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'users', key: 'id' },
  },
  fiscalYear: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
}, {
  tableName: 'documents',
  timestamps: true,
  indexes: [
    { fields: ['documentType'] },
    { fields: ['processingStatus'] },
    { fields: ['fiscalYear'] },
  ],
});

module.exports = Document;
