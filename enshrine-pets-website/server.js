/**
 * Enshrine 欣奉 — Pets Afterlife Services
 * Public website + admin backend (editable copy + image uploads, multi-user login).
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 20101;

const DATA_DIR = path.join(__dirname, 'data');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

// Image fields are identified by their key name.
const IMAGE_KEYS = ['image', 'logo', 'buildingImage'];
const isImageKey = (key) => IMAGE_KEYS.includes(key);

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}
function writeJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}
const loadContent = () => readJSON(CONTENT_FILE, {});
const saveContent = (c) => writeJSON(CONTENT_FILE, c);

// Seed an initial admin user if none exist.
function ensureUsers() {
  let users = readJSON(USERS_FILE, null);
  if (!Array.isArray(users) || users.length === 0) {
    const defaultPassword = process.env.ADMIN_PASSWORD || 'enshrine123';
    users = [{ username: 'admin', passwordHash: bcrypt.hashSync(defaultPassword, 10) }];
    writeJSON(USERS_FILE, users);
    console.log('\n  ┌──────────────────────────────────────────────┐');
    console.log('  │  No admin users found — created a default one:  │');
    console.log('  │    username: admin                             │');
    console.log(`  │    password: ${defaultPassword.padEnd(34)}│`);
    console.log('  │  Please log in and change it / add users.      │');
    console.log('  └──────────────────────────────────────────────┘\n');
  }
  return users;
}
const loadUsers = () => readJSON(USERS_FILE, []);
const saveUsers = (u) => writeJSON(USERS_FILE, u);

// Set a value at a dotted path inside an object, e.g. "services.cards.0.title".
function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur[k] === undefined || cur[k] === null) {
      // create object/array as needed based on next key
      cur[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    }
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));

// Tiny flash helper (avoids an extra dependency).
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.currentUser = req.session.user || null;
  next();
});
function flash(req, type, message) {
  req.session.flash = { type, message };
}

// Uploads: keep original-ish name but make it unique & safe.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');
    const stamp = crypto.randomBytes(4).toString('hex');
    cb(null, `${stamp}-${safe || 'image'}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  }
});

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect('/admin/login');
}

// ---------------------------------------------------------------------------
// Public site
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.render('index', { c: loadContent() });
});

// ---------------------------------------------------------------------------
// Admin: auth
// ---------------------------------------------------------------------------
app.get('/admin/login', (req, res) => {
  if (req.session.user) return res.redirect('/admin');
  res.render('login');
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  const user = loadUsers().find(u => u.username === (username || '').trim());
  if (user && bcrypt.compareSync(password || '', user.passwordHash)) {
    req.session.user = { username: user.username };
    return res.redirect('/admin');
  }
  flash(req, 'error', 'Invalid username or password.');
  res.redirect('/admin/login');
});

app.post('/admin/logout', requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ---------------------------------------------------------------------------
// Admin: content editor
// ---------------------------------------------------------------------------
app.get('/admin', requireAuth, (req, res) => {
  res.render('admin', { c: loadContent(), isImageKey });
});

app.post('/admin/save', requireAuth, upload.any(), (req, res) => {
  try {
    const content = loadContent();

    // 1) Apply all text fields from the form (names are dotted paths).
    for (const [key, value] of Object.entries(req.body)) {
      if (key === '_section') continue;
      setPath(content, key, value);
    }

    // 2) Apply uploaded images — fieldname is the dotted path of the image.
    for (const file of req.files || []) {
      setPath(content, file.fieldname, '/uploads/' + file.filename);
    }

    saveContent(content);
    flash(req, 'success', 'Changes saved. Your website has been updated.');
  } catch (e) {
    console.error(e);
    flash(req, 'error', 'Something went wrong while saving: ' + e.message);
  }
  res.redirect('/admin' + (req.body._section ? '#' + req.body._section : ''));
});

// ---------------------------------------------------------------------------
// Admin: user management
// ---------------------------------------------------------------------------
app.get('/admin/users', requireAuth, (req, res) => {
  res.render('users', { users: loadUsers() });
});

app.post('/admin/users/add', requireAuth, (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const users = loadUsers();
  if (!username || !password) {
    flash(req, 'error', 'Username and password are required.');
  } else if (users.some(u => u.username === username)) {
    flash(req, 'error', 'That username already exists.');
  } else {
    users.push({ username, passwordHash: bcrypt.hashSync(password, 10) });
    saveUsers(users);
    flash(req, 'success', `User "${username}" added.`);
  }
  res.redirect('/admin/users');
});

app.post('/admin/users/password', requireAuth, (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const users = loadUsers();
  const user = users.find(u => u.username === username);
  if (user && password) {
    user.passwordHash = bcrypt.hashSync(password, 10);
    saveUsers(users);
    flash(req, 'success', `Password updated for "${username}".`);
  } else {
    flash(req, 'error', 'Could not update password.');
  }
  res.redirect('/admin/users');
});

app.post('/admin/users/delete', requireAuth, (req, res) => {
  const username = (req.body.username || '').trim();
  let users = loadUsers();
  if (users.length <= 1) {
    flash(req, 'error', 'Cannot delete the last remaining admin user.');
  } else if (username === req.session.user.username) {
    flash(req, 'error', 'You cannot delete the account you are logged in with.');
  } else {
    users = users.filter(u => u.username !== username);
    saveUsers(users);
    flash(req, 'success', `User "${username}" removed.`);
  }
  res.redirect('/admin/users');
});

// Multer / generic error handler
app.use((err, req, res, next) => {
  console.error(err);
  flash(req, 'error', err.message || 'Upload error.');
  res.redirect('back');
});

// ---------------------------------------------------------------------------
ensureUsers();
app.listen(PORT, () => {
  console.log(`\n  Enshrine website running:`);
  console.log(`    Public site : http://localhost:${PORT}/`);
  console.log(`    Admin panel : http://localhost:${PORT}/admin\n`);
});
