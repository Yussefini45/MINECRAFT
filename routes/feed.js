const express = require('express');
const multer = require('multer');
const path = require('path');
const dayjs = require('dayjs');
const { nanoid } = require('nanoid');
const { all, get, run } = require('../lib/db');

const router = express.Router();

const upload = multer({ dest: path.resolve(__dirname, '../uploads') });

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

router.get('/', requireAuth, async (req, res) => {
  const posts = await all(
    `SELECT p.*, u.username, u.display_name, u.avatar_path,
            (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as like_count,
            (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comment_count,
            EXISTS(SELECT 1 FROM likes l2 WHERE l2.post_id = p.id AND l2.user_id = ?) as liked_by_me
     FROM posts p
     JOIN users u ON u.id = p.user_id
     ORDER BY p.created_at DESC
     LIMIT 50`,
    [req.session.userId]
  );
  res.render('feed', { posts });
});

router.post('/create', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const id = nanoid();
    const user_id = req.session.userId;
    const content = (req.body.content || '').slice(0, 500);
    let image_path = '';
    if (req.file) {
      const fs = require('fs');
      const destDir = path.resolve(__dirname, '../public/img/posts');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, `${id}.png`);
      fs.renameSync(req.file.path, destPath);
      image_path = `/public/img/posts/${id}.png`;
    }
    const created_at = dayjs().toISOString();
    await run(
      'INSERT INTO posts (id, user_id, content, image_path, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, user_id, content, image_path, created_at]
    );
    res.redirect('/feed');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating post');
  }
});

router.post('/:id/like', requireAuth, async (req, res) => {
  try {
    const post_id = req.params.id;
    const user_id = req.session.userId;
    const created_at = dayjs().toISOString();
    await run('INSERT OR IGNORE INTO likes (user_id, post_id, created_at) VALUES (?, ?, ?)', [user_id, post_id, created_at]);
    res.redirect('/feed');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error liking post');
  }
});

router.post('/:id/unlike', requireAuth, async (req, res) => {
  try {
    const post_id = req.params.id;
    const user_id = req.session.userId;
    await run('DELETE FROM likes WHERE user_id = ? AND post_id = ?', [user_id, post_id]);
    res.redirect('/feed');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error unliking post');
  }
});

router.post('/:id/comment', requireAuth, async (req, res) => {
  try {
    const id = nanoid();
    const post_id = req.params.id;
    const user_id = req.session.userId;
    const content = (req.body.content || '').slice(0, 300);
    const created_at = dayjs().toISOString();
    await run('INSERT INTO comments (id, post_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)', [id, post_id, user_id, content, created_at]);
    res.redirect('/feed');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error commenting');
  }
});

module.exports = router;
