const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const rateLimit = require('express-rate-limit');
const methodOverride = require('method-override');

const authRoutes = require('./routes/auth');
const feedRoutes = require('./routes/feed');
const profileRoutes = require('./routes/profile');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
// Ensure data dir exists for session store and other assets
const fs = require('fs');
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'data') }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 },
  })
);

app.use((req, res, next) => {
  res.locals.currentUserId = req.session.userId || null;
  res.locals.currentUsername = req.session.username || null;
  next();
});

// Ensure data dir exists for session store and other assets
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

app.use('/public', express.static(path.join(__dirname, 'public')));

// Simple search input on nav submits to /search?q=...
app.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.render('landing');
  const { all } = require('./lib/db');
  const users = await all(
    `SELECT username, display_name, avatar_path, bio FROM users
     WHERE username LIKE ? OR display_name LIKE ?
     ORDER BY username LIMIT 20`,
    [`%${q}%`, `%${q}%`]
  );
  res.render('search', { q, users });
});

// Basic rate limiting for auth and write routes
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const writeLimiter = rateLimit({ windowMs: 1 * 60 * 1000, max: 60 });
app.use(['/login', '/signup'], authLimiter);
app.use(['/feed/create', /\/feed\/.+\/(comment|like|unlike)/, /^\/u\/[^/]+\/(follow|unfollow)$/], writeLimiter);

app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/feed');
  res.render('landing');
});

app.use('/', authRoutes);
app.use('/feed', feedRoutes);
app.use('/u', profileRoutes);

app.use((req, res) => {
  res.status(404).render('404');
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
