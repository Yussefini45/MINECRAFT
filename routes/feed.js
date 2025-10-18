const express = require('express');
const multer = require('multer');
const path = require('path');
const dayjs = require('dayjs');
const { nanoid } = require('nanoid');
const { all, get, run } = require('../lib/db');

const router = express.Router();
const { formatContent } = require('../utils/format');

const upload = multer({ dest: path.resolve(__dirname, '../uploads'), limits: { fileSize: 10 * 1024 * 1024 } });
const fs = require('fs');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

router.get('/', requireAuth, async (req, res) => {
  const tab = (req.query.tab === 'following') ? 'following' : 'global';
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const PAGE_SIZE = 20;
  const offset = (page - 1) * PAGE_SIZE;

  const baseSelect = `SELECT p.*, u.username, u.display_name, u.avatar_path,
            (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as like_count,
            (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comment_count,
            EXISTS(SELECT 1 FROM likes l2 WHERE l2.post_id = p.id AND l2.user_id = ?) as liked_by_me
     FROM posts p
     JOIN users u ON u.id = p.user_id`;

  let posts;
  if (tab === 'following') {
    posts = await all(
      `${baseSelect}
       WHERE u.id IN (SELECT following_id FROM follows WHERE follower_id = ?)
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.session.userId, req.session.userId, PAGE_SIZE, offset]
    );
  } else {
    posts = await all(
      `${baseSelect}
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.session.userId, PAGE_SIZE, offset]
    );
  }

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

  // who to follow suggestions: top 5 users not me and not already followed
  const suggestions = await all(
    `SELECT u.username, u.display_name, u.avatar_path
     FROM users u
     WHERE u.id != ? AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
     ORDER BY u.created_at DESC
     LIMIT 5`,
    [req.session.userId, req.session.userId]
  );

  const enriched = posts.map(p => ({
    ...p,
    content: formatContent(p.content),
    comments: (commentsByPostId[p.id] || []).map(c => ({ ...c, content: formatContent(c.content) })),
  }));
  res.render('feed', { posts: enriched, tab, page, PAGE_SIZE, suggestions });
});

router.post('/create', requireAuth, upload.single('image'), async (req, res) => {
  try {
    const id = nanoid();
    const user_id = req.session.userId;
    const content = (req.body.content || '').slice(0, 500);
    let image_path = '';
    if (req.file) {
      const allowed = ['image/png', 'image/jpeg', 'image/webp'];
      if (!allowed.includes(req.file.mimetype)) {
        return res.status(400).send('Invalid image type');
      }
      const fs = require('fs');
      const destDir = path.resolve(__dirname, '../public/img/posts');
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const ext = req.file.mimetype === 'image/png' ? 'png' : (req.file.mimetype === 'image/webp' ? 'webp' : 'jpg');
      const destPath = path.join(destDir, `${id}.${ext}`);
      fs.renameSync(req.file.path, destPath);
      image_path = `/public/img/posts/${id}.${ext}`;
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

// Delete a post (owner only) - define BEFORE the permalink GET to avoid shadowing issues
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

// Post permalink page
router.get('/:id', requireAuth, async (req, res) => {
  const post = await get(
    `SELECT p.*, u.username, u.display_name, u.avatar_path,
            (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as like_count,
            EXISTS(SELECT 1 FROM likes l2 WHERE l2.post_id = p.id AND l2.user_id = ?) as liked_by_me
     FROM posts p
     JOIN users u ON u.id = p.user_id
     WHERE p.id = ?`,
    [req.session.userId, req.params.id]
  );
  if (!post) return res.status(404).render('404');

  const comments = await all(
    `SELECT c.*, u.username, u.avatar_path
     FROM comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.post_id = ?
     ORDER BY c.created_at ASC`,
    [req.params.id]
  );

  const formattedPost = { ...post, content: formatContent(post.content) };
  const formattedComments = comments.map(c => ({ ...c, content: formatContent(c.content) }));
  res.render('post', { post: formattedPost, comments: formattedComments });
});

// Delete comment (owner only)
router.post('/:postId/comment/:commentId/delete', requireAuth, async (req, res) => {
  try {
    const c = await get('SELECT * FROM comments WHERE id = ?', [req.params.commentId]);
    if (!c) return res.status(404).send('Not found');
    if (c.user_id !== req.session.userId) return res.status(403).send('Forbidden');
    await run('DELETE FROM comments WHERE id = ?', [req.params.commentId]);
    res.redirect(`/feed/${req.params.postId}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error deleting comment');
  }
});

module.exports = router;
