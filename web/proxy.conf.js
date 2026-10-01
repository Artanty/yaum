// `npm start` in ../back listens on 8000 by default; YAUM_API lets you point the dev
// server at another host/port (e.g. YAUM_API=http://127.0.0.1:8123 npm start).
const target = process.env.YAUM_API || 'http://127.0.0.1:8000';

module.exports = {
  '/api': { target, secure: false, changeOrigin: true, logLevel: 'warn' },
};
