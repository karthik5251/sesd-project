const app = require('../backend/app');
const store = require('../backend/store');

let initPromise = null;

module.exports = async (req, res) => {
  if (!initPromise) {
    initPromise = store.init(process.env.MONGODB_URI);
  }
  await initPromise;
  return app(req, res);
};
