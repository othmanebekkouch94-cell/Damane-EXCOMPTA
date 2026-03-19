const sequelize = require('../config/database');
const User = require('./User');
const ChartOfAccounts = require('./ChartOfAccounts');
const { JournalEntry, JournalLine } = require('./JournalEntry');
const BankTransaction = require('./BankTransaction');
const Document = require('./Document');

// Relations supplémentaires
const ChartOfAccountsModel = ChartOfAccounts;
JournalLine.belongsTo(ChartOfAccountsModel, { as: 'account', foreignKey: 'accountId' });
ChartOfAccountsModel.hasMany(JournalLine, { foreignKey: 'accountId' });

BankTransaction.belongsTo(JournalEntry, { foreignKey: 'journalEntryId' });
BankTransaction.belongsTo(ChartOfAccountsModel, { as: 'suggestedAccount', foreignKey: 'suggestedAccountId' });

Document.belongsTo(User, { as: 'uploader', foreignKey: 'uploadedBy' });

module.exports = {
  sequelize,
  User,
  ChartOfAccounts,
  JournalEntry,
  JournalLine,
  BankTransaction,
  Document,
};
