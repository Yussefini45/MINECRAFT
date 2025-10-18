const express = require('express');
const { all, get, run } = require('../lib/db');
const path = require('path');
const multer = require('multer');
const social = require('../lib/social');
const dayjs = require('dayjs');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

router.get('/:username', async (req, res) => {
  const username = req.params.username;
  const user = await get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) return res.status(404).render('404');
  const posts = await all(
    `SELECT p.*, u.username, u.display_name, u.avatar_path,
            (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as like_count,
            (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comment_count
     FROM posts p
     JOIN users u ON u.id = p.user_id
     WHERE u.id = ?
     ORDER BY p.created_at DESC
     LIMIT 50`,
    [user.id]
  );

  let isFollowing = false;
  if (req.session.userId) {
    const f = await get('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?', [req.session.userId, user.id]);
    isFollowing = !!f;
  }

  // follower/following counts
  const followerCountRow = await get('SELECT COUNT(*) as cnt FROM follows WHERE following_id = ?', [user.id]);
  const followingCountRow = await get('SELECT COUNT(*) as cnt FROM follows WHERE follower_id = ?', [user.id]);
  res.render('profile', { user, posts, isFollowing, followerCount: followerCountRow?.cnt || 0, followingCount: followingCountRow?.cnt || 0 });
});

router.post('/:username/follow', requireAuth, async (req, res) => {
  const target = await get('SELECT id FROM users WHERE username = ?', [req.params.username]);
  if (!target) return res.status(404).render('404');
  if (target.id === req.session.userId) return res.redirect(`/u/${req.params.username}`);
  await run('INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)', [
    req.session.userId,
    target.id,
    dayjs().toISOString(),
  ]);
  // notify follow
  if (target.id !== req.session.userId) {
    const { createNotification } = require('../lib/social');
    await createNotification({ userId: target.id, actorId: req.session.userId, type: 'follow' });
  }
  res.redirect(`/u/${req.params.username}`);
});

router.post('/:username/unfollow', requireAuth, async (req, res) => {
  const target = await get('SELECT id FROM users WHERE username = ?', [req.params.username]);
  if (!target) return res.status(404).render('404');
  await run('DELETE FROM follows WHERE follower_id = ? AND following_id = ?', [req.session.userId, target.id]);
  res.redirect(`/u/${req.params.username}`);
});

router.get('/me/edit', requireAuth, async (req, res) => {
  const me = await get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  res.render('profile_edit', { me });
});

const upload = multer({ dest: path.resolve(__dirname, '../uploads') });

router.post('/me/edit', requireAuth, upload.single('avatar'), async (req, res) => {
  const { display_name, bio } = req.body;
  let avatarPath = '';
  if (req.file) {
    avatarPath = social.saveUploadedAvatar(req.file, req.session.userId);
  }
  if (avatarPath) {
    await run('UPDATE users SET display_name = ?, bio = ?, avatar_path = ? WHERE id = ?', [
      display_name,
      bio,
      avatarPath,
      req.session.userId,
    ]);
  } else {
    await run('UPDATE users SET display_name = ?, bio = ? WHERE id = ?', [display_name, bio, req.session.userId]);
  }
  res.redirect(`/u/${req.session.username || ''}`);
});

module.exports = router;
