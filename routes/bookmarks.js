const express = require('express');
const dayjs = require('dayjs');
const { all, run } = require('../lib/db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

router.post('/:postId/toggle', requireAuth, async (req, res) => {
  const postId = req.params.postId;
  const created_at = dayjs().toISOString();
  try {
    await run('INSERT OR IGNORE INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)', [
      req.session.userId,
      postId,
      created_at,
    ]);
    res.redirect('back');
  } catch (e) {
    res.status(500).send('Error bookmarking');
  }
});

router.get('/', requireAuth, async (req, res) => {
  const posts = await all(
    `SELECT p.*, u.username, u.display_name, u.avatar_path,
            (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as like_count
     FROM bookmarks b
     JOIN posts p ON p.id = b.post_id
     JOIN users u ON u.id = p.user_id
     WHERE b.user_id = ?
     ORDER BY b.created_at DESC LIMIT 100`,
    [req.session.userId]
  );
  res.render('bookmarks', { posts });
});

module.exports = router;
