const express = require('express');
const multer = require('multer');
const path = require('path');
const dayjs = require('dayjs');
const { nanoid } = require('nanoid');
const { all, get, run } = require('../lib/db');
const social = require('../lib/social');

const router = express.Router();

const upload = multer({ dest: path.resolve(__dirname, '../uploads') });
const fs = require('fs');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

router.get('/', requireAuth, async (req, res) => {
  const followingOnly = req.query.tab === 'following';
  const posts = await social.buildFeed({ viewerId: req.session.userId, followingOnly, limit: 50 });
  // Fetch comments for these posts
  const postIds = posts.map(p => p.id);
  let commentsByPostId = {};
  if (postIds.length) {
    const placeholders = postIds.map(() => '?').join(',');
    const comments = await all(
      `SELECT c.*, u.username, u.avatar_path
       FROM comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.post_id IN (${placeholders})
       ORDER BY c.created_at ASC`,
      postIds
    );
    commentsByPostId = comments.reduce((acc, c) => {
      if (!acc[c.post_id]) acc[c.post_id] = [];
      acc[c.post_id].push(c);
      return acc;
    }, {});
  }
  const enriched = posts.map(p => ({ ...p, comments: commentsByPostId[p.id] || [] }));
  res.render('feed', { posts: enriched, tab: followingOnly ? 'following' : 'for-you' });
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
    // notifications for mentions
    await social.notifyMentions({ text: content, actorId: user_id, postId: id });
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
    const nowLiked = await social.toggleLike(user_id, post_id);
    if (nowLiked) {
      const owner = await get('SELECT user_id FROM posts WHERE id = ?', [post_id]);
      if (owner && owner.user_id !== user_id) {
        await social.createNotification({ userId: owner.user_id, actorId: user_id, type: 'like', postId: post_id });
      }
    }
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
    // notify post owner and mentions
    const post = await get('SELECT user_id FROM posts WHERE id = ?', [post_id]);
    if (post && post.user_id !== user_id) {
      await social.createNotification({ userId: post.user_id, actorId: user_id, type: 'comment', postId: post_id });
    }
    await social.notifyMentions({ text: content, actorId: user_id, postId, commentId: id });
    res.redirect('/feed');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error commenting');
  }
});

module.exports = router;

// Delete a post (owner only)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const post_id = req.params.id;
    const post = await get('SELECT * FROM posts WHERE id = ?', [post_id]);
    if (!post) return res.status(404).send('Not found');
    if (post.user_id !== req.session.userId) return res.status(403).send('Forbidden');
    // remove image if exists
    if (post.image_path) {
      const imgPath = path.resolve(__dirname, `..${post.image_path}`);
      try { fs.unlinkSync(imgPath); } catch (_) {}
    }
    await run('DELETE FROM posts WHERE id = ?', [post_id]);
    res.redirect('/feed');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error deleting post');
  }
});

// Edit post - form
router.get('/:id/edit', requireAuth, async (req, res) => {
  const post = await get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
  if (!post || post.user_id !== req.session.userId) return res.status(403).send('Forbidden');
  res.render('post_edit', { post });
});

// Update post
router.put('/:id/edit', requireAuth, async (req, res) => {
  const post = await get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
  if (!post || post.user_id !== req.session.userId) return res.status(403).send('Forbidden');
  const content = (req.body.content || '').slice(0, 500);
  await run('UPDATE posts SET content = ? WHERE id = ?', [content, req.params.id]);
  res.redirect('/feed');
});

// Delete a comment by owner
router.delete('/comment/:id', requireAuth, async (req, res) => {
  const comment = await get('SELECT * FROM comments WHERE id = ?', [req.params.id]);
  if (!comment || comment.user_id !== req.session.userId) return res.status(403).send('Forbidden');
  await run('DELETE FROM comments WHERE id = ?', [req.params.id]);
  res.redirect('back');
});
