const express = require('express');
const { searchPostsAndUsers } = require('../lib/social');

const router = express.Router();

router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.render('search', { q, posts: [], users: [] });
  const { posts, users } = await searchPostsAndUsers(q);
  res.render('search', { q, posts, users });
});

module.exports = router;
