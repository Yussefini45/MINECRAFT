const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const methodOverride = require('method-override');

const authRoutes = require('./routes/auth');
const feedRoutes = require('./routes/feed');
const profileRoutes = require('./routes/profile');
const exploreRoutes = require('./routes/explore');
const notificationsRoutes = require('./routes/notifications');
const searchRoutes = require('./routes/search');
const bookmarksRoutes = require('./routes/bookmarks');
const repostRoutes = require('./routes/repost');
const { get } = require('./lib/db');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 },
  })
);

// inject commonly used locals for templates
app.use(async (req, res, next) => {
  res.locals.currentUserId = req.session.userId || null;
  res.locals.currentUsername = req.session.username || null;
  // linkify mentions and hashtags
  res.locals.linkify = function linkify(text) {
    if (!text) return '';
    const esc = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return esc
      .replace(/(^|\s)@([a-zA-Z0-9_]{2,30})/g, '$1<a href="/u/$2">@$2</a>')
      .replace(/(^|\s)#([\p{L}0-9_]{2,30})/gu, '$1<a href="/search?q=%23$2">#$2</a>');
  };
  // unread notifications badge
  res.locals.unreadCount = 0;
  try {
    if (req.session.userId) {
      const row = await get('SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0', [
        req.session.userId,
      ]);
      res.locals.unreadCount = row?.cnt || 0;
    }
  } catch (_) {}
  next();
});

app.use('/public', express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/feed');
  res.render('landing');
});

app.use('/', authRoutes);
app.use('/feed', feedRoutes);
app.use('/u', profileRoutes);
app.use('/explore', exploreRoutes);
app.use('/notifications', notificationsRoutes);
app.use('/search', searchRoutes);
app.use('/bookmarks', bookmarksRoutes);
app.use('/repost', repostRoutes);

app.use((req, res) => {
  res.status(404).render('404');
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
