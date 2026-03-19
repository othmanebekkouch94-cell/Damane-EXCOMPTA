/**
 * Seed script — creates a default admin user if none exists.
 * Run manually:  node seed.js
 * Also called automatically from server.js on first start.
 */
const { User } = require('./models');

async function seed() {
  try {
    // Check if any user already exists
    const count = await User.count();
    if (count > 0) {
      console.log(`  [seed] ${count} utilisateur(s) existant(s). Seed ignoré.`);
      return;
    }

    // Create default admin
    await User.create({
      email: 'admin@damane.eu',
      password: 'Admin2026!',
      firstName: 'Admin',
      lastName: 'DAMANE',
      role: 'admin',
      isActive: true,
    });

    // Create a demo comptable user
    await User.create({
      email: 'comptable@damane.eu',
      password: 'Comptable2026!',
      firstName: 'Marie',
      lastName: 'Dupont',
      role: 'editor',
      isActive: true,
    });

    console.log('  [seed] Utilisateurs créés avec succès :');
    console.log('         admin@damane.eu    / Admin2026!');
    console.log('         comptable@damane.eu / Comptable2026!');
  } catch (error) {
    console.error('  [seed] Erreur:', error.message);
  }
}

// If run directly: node seed.js
if (require.main === module) {
  const { sequelize } = require('./models');
  sequelize.authenticate()
    .then(() => sequelize.sync({ alter: true }))
    .then(() => seed())
    .then(() => process.exit(0))
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = seed;
