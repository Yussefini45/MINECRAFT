const express = require('express');
const { all, get, run } = require('../lib/db');
const dayjs = require('dayjs');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

router.post('/:username/follow', requireAuth, async (req, res) => {
  const target = await get('SELECT id FROM users WHERE username = ?', [req.params.username]);
  if (!target) return res.status(404).render('404');
  if (target.id === req.session.userId) return res.redirect(`/u/${req.params.username}`);
  await run('INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)', [
    req.session.userId,
    target.id,
    dayjs().toISOString(),
  ]);
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

// Support avatar upload on profile edit
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const upload = multer({ dest: path.resolve(__dirname, '../uploads'), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/me/edit', requireAuth, upload.single('avatar'), async (req, res) => {
  const { display_name, bio } = req.body;
  let avatar_path_fragment = null;
  try {
    const safeDisplayName = String(display_name || '').trim().slice(0, 50);
    const safeBio = String(bio || '').trim().slice(0, 280);
    if (req.file) {
      const allowed = ['image/png', 'image/jpeg', 'image/webp'];
      if (!allowed.includes(req.file.mimetype)) {
        return res.status(400).render('profile_edit', { me: { display_name: safeDisplayName, bio: safeBio }, error: 'Avatar must be PNG, JPG, or WEBP' });
      }
      const avatarsDir = path.resolve(__dirname, '../public/img/avatars');
      if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
      const destPath = path.join(avatarsDir, `${req.session.userId}.png`);
      fs.renameSync(req.file.path, destPath);
      avatar_path_fragment = `/public/img/avatars/${req.session.userId}.png`;
    }

    if (avatar_path_fragment) {
      await run('UPDATE users SET display_name = ?, bio = ?, avatar_path = ? WHERE id = ?', [safeDisplayName, safeBio, avatar_path_fragment, req.session.userId]);
    } else {
      await run('UPDATE users SET display_name = ?, bio = ? WHERE id = ?', [safeDisplayName, safeBio, req.session.userId]);
    }
    res.redirect(`/u/${req.session.username || ''}`);
  } catch (err) {
    console.error(err);
    res.status(500).render('profile_edit', { me: { display_name: String(display_name || ''), bio: String(bio || '') }, error: 'Failed to update profile' });
  }
});

module.exports = router;

// Place dynamic profile route AFTER specific routes like /me/edit to avoid shadowing
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

  const followerCountRow = await get('SELECT COUNT(*) as cnt FROM follows WHERE following_id = ?', [user.id]);
  const followingCountRow = await get('SELECT COUNT(*) as cnt FROM follows WHERE follower_id = ?', [user.id]);
  const { formatContent } = require('../utils/format');
  const formattedPosts = posts.map(p => ({ ...p, content: formatContent(p.content) }));
  res.render('profile', { user, posts: formattedPosts, isFollowing, followerCount: followerCountRow?.cnt || 0, followingCount: followingCountRow?.cnt || 0 });
});

router.get('/:username/followers', async (req, res) => {
  const username = req.params.username;
  const user = await get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) return res.status(404).render('404');
  const followers = await all(
    `SELECT u.username, u.display_name, u.avatar_path
     FROM follows f
     JOIN users u ON u.id = f.follower_id
     WHERE f.following_id = ?
     ORDER BY f.created_at DESC`,
    [user.id]
  );
  res.render('followers', { user, list: followers, title: 'Followers' });
});

router.get('/:username/following', async (req, res) => {
  const username = req.params.username;
  const user = await get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) return res.status(404).render('404');
  const following = await all(
    `SELECT u.username, u.display_name, u.avatar_path
     FROM follows f
     JOIN users u ON u.id = f.following_id
     WHERE f.follower_id = ?
     ORDER BY f.created_at DESC`,
    [user.id]
  );
  res.render('followers', { user, list: following, title: 'Following' });
});
