const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');
const { nanoid } = require('nanoid');
const { all, get, run } = require('./db');

// 1) Parse hashtags from text
function parseHashtags(text) {
  if (!text) return [];
  const tags = new Set();
  String(text)
    .match(/(^|\s)#([\p{L}0-9_]{2,30})/gu)?.forEach((m) => {
      const cleaned = m.trim().replace(/^#/, '');
      if (cleaned) tags.add(cleaned.toLowerCase());
    });
  return Array.from(tags);
}

// 2) Parse mentions from text
function parseMentions(text) {
  if (!text) return [];
  const users = new Set();
  String(text)
    .match(/(^|\s)@([a-zA-Z0-9_]{2,30})/g)?.forEach((m) => {
      const cleaned = m.trim().replace(/^@/, '');
      if (cleaned) users.add(cleaned.toLowerCase());
    });
  return Array.from(users);
}

// 3) Create notification
async function createNotification({ userId, actorId, type, postId = '', commentId = '' }) {
  const id = nanoid();
  const created_at = dayjs().toISOString();
  await run(
    'INSERT INTO notifications (id, user_id, actor_id, type, post_id, comment_id, created_at, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
    [id, userId, actorId, type, postId, commentId, created_at]
  );
  return id;
}

// 4) Notify all mentioned users in a text
async function notifyMentions({ text, actorId, postId = '', commentId = '' }) {
  const usernames = parseMentions(text);
  if (!usernames.length) return 0;
  const placeholders = usernames.map(() => '?').join(',');
  const users = await all(`SELECT id, username FROM users WHERE username IN (${placeholders})`, usernames);
  await Promise.all(
    users
      .filter((u) => u.id !== actorId)
      .map((u) => createNotification({ userId: u.id, actorId, type: 'mention', postId, commentId }))
  );
  return users.length;
}

// 5) Compute trending hashtags from recent posts
async function getTrendingHashtags(limit = 10) {
  const since = dayjs().subtract(7, 'day').toISOString();
  const rows = await all('SELECT content FROM posts WHERE created_at >= ? ORDER BY created_at DESC LIMIT 1000', [since]);
  const counts = new Map();
  rows.forEach((r) => {
    parseHashtags(r.content).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1));
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}

// 6) Linkify helper for serverside rendering
function linkify(text) {
  if (!text) return '';
  const esc = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .replace(/(^|\s)@([a-zA-Z0-9_]{2,30})/g, '$1<a href="/u/$2">@$2</a>')
    .replace(/(^|\s)#([\p{L}0-9_]{2,30})/gu, '$1<a href="/search?q=%23$2">#$2</a>');
}

// 7) Build feed with optional following-only filter
async function buildFeed({ viewerId, followingOnly = false, limit = 50 }) {
  let sql = `SELECT p.*, u.username, u.display_name, u.avatar_path,
            (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) as like_count,
            (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) as comment_count,
            EXISTS(SELECT 1 FROM likes l2 WHERE l2.post_id = p.id AND l2.user_id = ?) as liked_by_me,
            EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = ?) as bookmarked_by_me,
            EXISTS(SELECT 1 FROM reposts r WHERE r.post_id = p.id AND r.user_id = ?) as reposted_by_me
     FROM posts p
     JOIN users u ON u.id = p.user_id`;
  const params = [viewerId || '', viewerId || '', viewerId || ''];
  if (followingOnly && viewerId) {
    sql += ` JOIN follows f ON f.following_id = u.id AND f.follower_id = ?`;
    params.push(viewerId);
  }
  sql += ' ORDER BY p.created_at DESC LIMIT ?';
  params.push(limit);
  const posts = await all(sql, params);
  return posts;
}

// 8) Get single post enriched
async function getPostWithAggregates(postId, viewerId) {
  const posts = await buildFeed({ viewerId, followingOnly: false, limit: 1 });
  return posts.find((p) => p.id === postId) || null;
}

// 9) Permission check for editing post
function canEditPost(post, userId) {
  return post && post.user_id === userId;
}

// 10) Permission check for deleting comment
function canDeleteComment(comment, userId) {
  return comment && comment.user_id === userId;
}

// 11) Toggle bookmark, return new state
async function toggleBookmark(userId, postId) {
  const created_at = dayjs().toISOString();
  await run('INSERT OR IGNORE INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)', [userId, postId, created_at]);
  const row = await get('SELECT 1 FROM bookmarks WHERE user_id = ? AND post_id = ?', [userId, postId]);
  if (row) return true;
  await run('DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?', [userId, postId]);
  return false;
}

// 12) Toggle like (if exists, remove; else add). Returns state
async function toggleLike(userId, postId) {
  const existing = await get('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?', [userId, postId]);
  if (existing) {
    await run('DELETE FROM likes WHERE user_id = ? AND post_id = ?', [userId, postId]);
    return false;
  }
  const created_at = dayjs().toISOString();
  await run('INSERT INTO likes (user_id, post_id, created_at) VALUES (?, ?, ?)', [userId, postId, created_at]);
  return true;
}

// 13) Toggle repost. Returns state
async function toggleRepost(userId, postId) {
  const existing = await get('SELECT 1 FROM reposts WHERE user_id = ? AND post_id = ?', [userId, postId]);
  if (existing) {
    await run('DELETE FROM reposts WHERE user_id = ? AND post_id = ?', [userId, postId]);
    return false;
  }
  const created_at = dayjs().toISOString();
  await run('INSERT INTO reposts (user_id, post_id, created_at) VALUES (?, ?, ?)', [userId, postId, created_at]);
  return true;
}

// 14) Compute unread notifications count for badge
async function computeUnreadCount(userId) {
  const row = await get('SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0', [userId]);
  return row?.cnt || 0;
}

// 15) Mark notifications as read
async function markNotificationsRead(userId) {
  await run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [userId]);
}

// 16) Search posts and users by query
async function searchPostsAndUsers(query) {
  const q = `%${query.replace(/^%+|%+$/g, '')}%`;
  const posts = await all(
    `SELECT p.*, u.username, u.display_name, u.avatar_path FROM posts p JOIN users u ON u.id = p.user_id
     WHERE p.content LIKE ? ORDER BY p.created_at DESC LIMIT 50`,
    [q]
  );
  const users = await all(
    'SELECT username, display_name, avatar_path FROM users WHERE username LIKE ? OR display_name LIKE ? ORDER BY created_at DESC LIMIT 20',
    [q, q]
  );
  return { posts, users };
}

// 17) Save uploaded avatar file in public/img/avatars
function saveUploadedAvatar(file, userId) {
  if (!file) return '';
  const destDir = path.resolve(__dirname, '../public/img/avatars');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `${userId}.png`);
  fs.renameSync(file.path, dest);
  return `/public/img/avatars/${userId}.png`;
}

// 18) Ensure user has default avatar path
function ensureDefaultAvatar(avatarPath) {
  return avatarPath && avatarPath.trim() ? avatarPath : '/public/css/steve.png';
}

module.exports = {
  parseHashtags,
  parseMentions,
  createNotification,
  notifyMentions,
  getTrendingHashtags,
  linkify,
  buildFeed,
  getPostWithAggregates,
  canEditPost,
  canDeleteComment,
  toggleBookmark,
  toggleLike,
  toggleRepost,
  computeUnreadCount,
  markNotificationsRead,
  searchPostsAndUsers,
  saveUploadedAvatar,
  ensureDefaultAvatar,
};
