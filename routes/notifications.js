const express = require('express');
const { all, run } = require('../lib/db');
const { markNotificationsRead } = require('../lib/social');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

router.get('/', requireAuth, async (req, res) => {
  const rows = await all(
    `SELECT n.*, a.username as actor_username, a.display_name as actor_display_name, a.avatar_path as actor_avatar
     FROM notifications n JOIN users a ON a.id = n.actor_id
     WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 100`,
    [req.session.userId]
  );
  await markNotificationsRead(req.session.userId);
  res.render('notifications', { items: rows });
});

module.exports = router;
