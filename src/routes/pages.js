const path = require('path');
const express = require('express');
const router = express.Router();

router.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html')));
router.get('/create/', (_req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'create', 'index.html')));
router.get('/host/:token', (_req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'host', 'index.html')));
router.get('/display/:code', (_req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'display', 'index.html')));
router.get('/play/', (_req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'play', 'index.html')));
router.get('/play/:code', (_req, res) => res.sendFile(path.join(__dirname, '..', '..', 'public', 'play', 'index.html')));

module.exports = router;
