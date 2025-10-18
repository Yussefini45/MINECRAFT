const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
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
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 },
  })
);

app.use((req, res, next) => {
  res.locals.currentUserId = req.session.userId || null;
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

app.use((req, res) => {
  res.status(404).render('404');
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));
