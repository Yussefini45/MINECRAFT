const express = require('express');
const dayjs = require('dayjs');
const { run, get } = require('../lib/db');
const { createNotification } = require('../lib/social');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

router.post('/:postId', requireAuth, async (req, res) => {
  const postId = req.params.postId;
  const userId = req.session.userId;
  const created_at = dayjs().toISOString();
  try {
    await run('INSERT OR IGNORE INTO reposts (user_id, post_id, created_at) VALUES (?, ?, ?)', [userId, postId, created_at]);
    const owner = await get('SELECT user_id FROM posts WHERE id = ?', [postId]);
    if (owner && owner.user_id !== userId) {
      await createNotification({ userId: owner.user_id, actorId: userId, type: 'repost', postId });
    }
    res.redirect('back');
  } catch (e) {
    res.status(500).send('Error reposting');
  }
});

module.exports = router;
