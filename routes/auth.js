const express = require('express');
const bcrypt = require('bcrypt');
const { nanoid } = require('nanoid');
const dayjs = require('dayjs');
const multer = require('multer');
const path = require('path');
const { run, get } = require('../lib/db');

const router = express.Router();

const upload = multer({ dest: path.resolve(__dirname, '../uploads') });

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/feed');
  res.render('auth_login');
});

router.get('/signup', (req, res) => {
  if (req.session.userId) return res.redirect('/feed');
  res.render('auth_signup');
});

router.post('/signup', upload.single('avatar'), async (req, res) => {
  try {
    const { username, display_name, password } = req.body;
    if (!username || !display_name || !password) {
      return res.status(400).render('auth_signup', { error: 'All fields are required' });
    }
    const existing = await get('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) return res.status(400).render('auth_signup', { error: 'Username taken' });

    const id = nanoid();
    const password_hash = await bcrypt.hash(password, 10);
    const created_at = dayjs().toISOString();
    const avatar_path = req.file ? `/public/img/avatars/${id}.png` : '';

    if (req.file) {
      // Save uploaded avatar into public/img/avatars
      const fs = require('fs');
      const destDir = path.resolve(__dirname, '../public/img/avatars');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      fs.renameSync(req.file.path, path.join(destDir, `${id}.png`));
    }

    await run(
      'INSERT INTO users (id, username, display_name, bio, avatar_path, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, username, display_name, '', avatar_path, password_hash, created_at]
    );

    req.session.userId = id;
    res.redirect('/feed');
  } catch (err) {
    console.error(err);
    res.status(500).render('auth_signup', { error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return res.status(401).render('auth_login', { error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).render('auth_login', { error: 'Invalid credentials' });
    req.session.userId = user.id;
    res.redirect('/feed');
  } catch (err) {
    console.error(err);
    res.status(500).render('auth_login', { error: 'Server error' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
