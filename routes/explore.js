const express = require('express');
const { all } = require('../lib/db');
const { getTrendingHashtags } = require('../lib/social');

const router = express.Router();

router.get('/', async (req, res) => {
  const tags = await getTrendingHashtags(12);
  const posts = await all(
    `SELECT p.*, u.username, u.display_name, u.avatar_path
     FROM posts p JOIN users u ON u.id = p.user_id
     ORDER BY p.created_at DESC LIMIT 20`
  );
  res.render('explore', { tags, posts });
});

module.exports = router;
