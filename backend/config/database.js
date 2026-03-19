const { Sequelize } = require('sequelize');
const path = require('path');
require('dotenv').config();

// En développement, utiliser SQLite (pas besoin de PostgreSQL/Docker)
const isDev = process.env.NODE_ENV !== 'production';

let sequelize;
if (isDev) {
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: path.join(__dirname, '..', 'damane_comptable.sqlite'),
    logging: false,
  });
} else {
  sequelize = new Sequelize(
    process.env.DB_NAME || 'damane_comptable',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD || 'postgres',
    {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      dialect: 'postgres',
      logging: false,
      pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
    }
  );
}

module.exports = sequelize;
