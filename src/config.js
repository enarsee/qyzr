const path = require('path');

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`,
  dataDir: path.resolve(process.env.DATA_DIR || './data'),
  nodeEnv: process.env.NODE_ENV || 'development'
};

module.exports = config;
