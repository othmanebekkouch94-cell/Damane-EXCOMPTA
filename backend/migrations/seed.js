/**
 * Seed script : Plan Comptable Général (PCG) français + admin user
 * Usage: node backend/migrations/seed.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { sequelize, User, ChartOfAccounts } = require('../models');

const PCG_ACCOUNTS = [
  // Classe 1 - Capitaux propres
  { accountNumber: '101000', accountName: 'Capital social', accountType: 'passif', accountClass: 1, normalBalance: 'credit' },
  { accountNumber: '106000', accountName: 'Réserves', accountType: 'passif', accountClass: 1, normalBalance: 'credit' },
  { accountNumber: '108000', accountName: 'Compte de l\'exploitant', accountType: 'passif', accountClass: 1, normalBalance: 'credit' },
  { accountNumber: '110000', accountName: 'Report à nouveau (solde créditeur)', accountType: 'passif', accountClass: 1, normalBalance: 'credit' },
  { accountNumber: '119000', accountName: 'Report à nouveau (solde débiteur)', accountType: 'actif', accountClass: 1, normalBalance: 'debit' },
  { accountNumber: '120000', accountName: 'Résultat de l\'exercice (bénéfice)', accountType: 'passif', accountClass: 1, normalBalance: 'credit' },
  { accountNumber: '129000', accountName: 'Résultat de l\'exercice (perte)', accountType: 'actif', accountClass: 1, normalBalance: 'debit' },
  { accountNumber: '164000', accountName: 'Emprunts auprès des établissements de crédit', accountType: 'passif', accountClass: 1, normalBalance: 'credit' },

  // Classe 2 - Immobilisations
  { accountNumber: '205000', accountName: 'Concessions, brevets, licences', accountType: 'actif', accountClass: 2, normalBalance: 'debit' },
  { accountNumber: '211000', accountName: 'Terrains', accountType: 'actif', accountClass: 2, normalBalance: 'debit' },
  { accountNumber: '213000', accountName: 'Constructions', accountType: 'actif', accountClass: 2, normalBalance: 'debit' },
  { accountNumber: '215000', accountName: 'Installations techniques, matériel et outillage', accountType: 'actif', accountClass: 2, normalBalance: 'debit' },
  { accountNumber: '218000', accountName: 'Autres immobilisations corporelles', accountType: 'actif', accountClass: 2, normalBalance: 'debit' },
  { accountNumber: '218300', accountName: 'Matériel de bureau et informatique', accountType: 'actif', accountClass: 2, normalBalance: 'debit' },
  { accountNumber: '218400', accountName: 'Mobilier', accountType: 'actif', accountClass: 2, normalBalance: 'debit' },
  { accountNumber: '261000', accountName: 'Titres de participation', accountType: 'actif', accountClass: 2, normalBalance: 'debit' },
  { accountNumber: '280000', accountName: 'Amortissements des immobilisations', accountType: 'actif', accountClass: 2, normalBalance: 'credit' },

  // Classe 3 - Stocks
  { accountNumber: '310000', accountName: 'Matières premières', accountType: 'actif', accountClass: 3, normalBalance: 'debit' },
  { accountNumber: '355000', accountName: 'Produits finis', accountType: 'actif', accountClass: 3, normalBalance: 'debit' },
  { accountNumber: '370000', accountName: 'Marchandises', accountType: 'actif', accountClass: 3, normalBalance: 'debit' },

  // Classe 4 - Tiers
  { accountNumber: '401000', accountName: 'Fournisseurs', accountType: 'passif', accountClass: 4, normalBalance: 'credit' },
  { accountNumber: '401100', accountName: 'Fournisseurs - Factures non parvenues', accountType: 'passif', accountClass: 4, normalBalance: 'credit' },
  { accountNumber: '408000', accountName: 'Fournisseurs - Factures non parvenues', accountType: 'passif', accountClass: 4, normalBalance: 'credit' },
  { accountNumber: '411000', accountName: 'Clients', accountType: 'actif', accountClass: 4, normalBalance: 'debit' },
  { accountNumber: '411100', accountName: 'Clients - Factures à établir', accountType: 'actif', accountClass: 4, normalBalance: 'debit' },
  { accountNumber: '418000', accountName: 'Clients - Produits non encore facturés', accountType: 'actif', accountClass: 4, normalBalance: 'debit' },
  { accountNumber: '421000', accountName: 'Personnel - Rémunérations dues', accountType: 'passif', accountClass: 4, normalBalance: 'credit' },
  { accountNumber: '431000', accountName: 'Sécurité sociale', accountType: 'passif', accountClass: 4, normalBalance: 'credit' },
  { accountNumber: '437000', accountName: 'Autres organismes sociaux', accountType: 'passif', accountClass: 4, normalBalance: 'credit' },
  { accountNumber: '441000', accountName: 'État - Subventions à recevoir', accountType: 'actif', accountClass: 4, normalBalance: 'debit' },
  { accountNumber: '445100', accountName: 'TVA à décaisser', accountType: 'passif', accountClass: 4, normalBalance: 'credit' },
  { accountNumber: '445620', accountName: 'TVA déductible sur immobilisations', accountType: 'actif', accountClass: 4, normalBalance: 'debit' },
  { accountNumber: '445660', accountName: 'TVA déductible sur autres biens et services', accountType: 'actif', accountClass: 4, normalBalance: 'debit' },
  { accountNumber: '445710', accountName: 'TVA collectée', accountType: 'passif', accountClass: 4, normalBalance: 'credit' },
  { accountNumber: '455000', accountName: 'Associés - Comptes courants', accountType: 'passif', accountClass: 4, normalBalance: 'credit' },
  { accountNumber: '467000', accountName: 'Autres comptes débiteurs ou créditeurs', accountType: 'actif', accountClass: 4, normalBalance: 'debit' },
  { accountNumber: '471000', accountName: 'Comptes d\'attente', accountType: 'actif', accountClass: 4, normalBalance: 'debit' },
  { accountNumber: '486000', accountName: 'Charges constatées d\'avance', accountType: 'actif', accountClass: 4, normalBalance: 'debit' },
  { accountNumber: '487000', accountName: 'Produits constatés d\'avance', accountType: 'passif', accountClass: 4, normalBalance: 'credit' },

  // Classe 5 - Financier
  { accountNumber: '512000', accountName: 'Banque', accountType: 'actif', accountClass: 5, normalBalance: 'debit' },
  { accountNumber: '512100', accountName: 'Banque - Compte courant', accountType: 'actif', accountClass: 5, normalBalance: 'debit' },
  { accountNumber: '514000', accountName: 'Chèques à encaisser', accountType: 'actif', accountClass: 5, normalBalance: 'debit' },
  { accountNumber: '530000', accountName: 'Caisse', accountType: 'actif', accountClass: 5, normalBalance: 'debit' },
  { accountNumber: '580000', accountName: 'Virements internes', accountType: 'actif', accountClass: 5, normalBalance: 'debit' },

  // Classe 6 - Charges
  { accountNumber: '601000', accountName: 'Achats de matières premières', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '602000', accountName: 'Achats d\'autres approvisionnements', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '606000', accountName: 'Achats non stockés de matières et fournitures', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '606100', accountName: 'Fournitures non stockables (eau, énergie)', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '606400', accountName: 'Fournitures administratives', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '607000', accountName: 'Achats de marchandises', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '611000', accountName: 'Sous-traitance générale', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '613000', accountName: 'Locations', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '615000', accountName: 'Entretien et réparations', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '616000', accountName: 'Primes d\'assurance', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '622000', accountName: 'Rémunérations d\'intermédiaires', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '623000', accountName: 'Publicité, publications', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '625000', accountName: 'Déplacements, missions, réceptions', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '626000', accountName: 'Frais postaux et télécommunications', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '627000', accountName: 'Services bancaires', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '641000', accountName: 'Rémunérations du personnel', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '645000', accountName: 'Charges de sécurité sociale', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '651000', accountName: 'Redevances pour concessions', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '661000', accountName: 'Charges d\'intérêts', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '671000', accountName: 'Charges exceptionnelles sur opérations de gestion', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '681000', accountName: 'Dotations aux amortissements et provisions', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },
  { accountNumber: '695000', accountName: 'Impôts sur les bénéfices', accountType: 'charge', accountClass: 6, normalBalance: 'debit' },

  // Classe 7 - Produits
  { accountNumber: '701000', accountName: 'Ventes de produits finis', accountType: 'produit', accountClass: 7, normalBalance: 'credit' },
  { accountNumber: '706000', accountName: 'Prestations de services', accountType: 'produit', accountClass: 7, normalBalance: 'credit' },
  { accountNumber: '707000', accountName: 'Ventes de marchandises', accountType: 'produit', accountClass: 7, normalBalance: 'credit' },
  { accountNumber: '708000', accountName: 'Produits des activités annexes', accountType: 'produit', accountClass: 7, normalBalance: 'credit' },
  { accountNumber: '740000', accountName: 'Subventions d\'exploitation', accountType: 'produit', accountClass: 7, normalBalance: 'credit' },
  { accountNumber: '761000', accountName: 'Produits de participations', accountType: 'produit', accountClass: 7, normalBalance: 'credit' },
  { accountNumber: '762000', accountName: 'Produits des autres immobilisations financières', accountType: 'produit', accountClass: 7, normalBalance: 'credit' },
  { accountNumber: '771000', accountName: 'Produits exceptionnels sur opérations de gestion', accountType: 'produit', accountClass: 7, normalBalance: 'credit' },
  { accountNumber: '775000', accountName: 'Produits de cession d\'éléments d\'actif', accountType: 'produit', accountClass: 7, normalBalance: 'credit' },
  { accountNumber: '781000', accountName: 'Reprises sur amortissements et provisions', accountType: 'produit', accountClass: 7, normalBalance: 'credit' },
];

async function seed() {
  try {
    await sequelize.authenticate();
    console.log('Connexion DB réussie.');

    await sequelize.sync({ alter: true });
    console.log('Modèles synchronisés.');

    // Créer admin par défaut
    const [admin, adminCreated] = await User.findOrCreate({
      where: { email: 'admin@damane-europe.com' },
      defaults: {
        firstName: 'Admin',
        lastName: 'DAMANE',
        password: 'DamaneAdmin2026!',
        role: 'admin',
      },
    });
    console.log(adminCreated ? 'Admin créé : admin@damane-europe.com / DamaneAdmin2026!' : 'Admin existe déjà.');

    // Créer utilisateur comptable
    const [comptable, comptableCreated] = await User.findOrCreate({
      where: { email: 'comptable@damane-europe.com' },
      defaults: {
        firstName: 'Comptable',
        lastName: 'DAMANE',
        password: 'Comptable2026!',
        role: 'editor',
      },
    });
    console.log(comptableCreated ? 'Comptable créé : comptable@damane-europe.com / Comptable2026!' : 'Comptable existe déjà.');

    // Importer le plan comptable
    let imported = 0;
    for (const acc of PCG_ACCOUNTS) {
      const [account, created] = await ChartOfAccounts.findOrCreate({
        where: { accountNumber: acc.accountNumber },
        defaults: acc,
      });
      if (created) imported++;
    }
    console.log(`Plan comptable : ${imported} comptes importés (${PCG_ACCOUNTS.length - imported} existants).`);

    console.log('\nSeed terminé avec succès !');
    process.exit(0);
  } catch (error) {
    console.error('Erreur seed:', error.message);
    process.exit(1);
  }
}

seed();
