'use strict';

// Database migrations are intentionally a separate command so deployment does
// not run DDL on every application replica during startup.
const { init } = require('./db');

init()
  .then(() => require('./services/home-migration')(require('./db').query))
  .then(() => require('./services/community-migration').migrate(require('./db').query))
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[migrate] failed:', error.message);
    process.exit(1);
  });
