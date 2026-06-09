/**
 * Enshrine 欣奉 — Pets Afterlife Services
 * Public website + admin backend (editable copy + image uploads, multi-user login).
 */
require('dotenv').config();
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
const I18N_DIR = path.join(DATA_DIR, 'i18n');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

// Image fields are identified by their key name.
const IMAGE_KEYS = ['image', 'logo', 'buildingImage', 'favicon'];
const isImageKey = (key) => IMAGE_KEYS.includes(key);

// ---------------------------------------------------------------------------
// Languages / i18n
// ---------------------------------------------------------------------------
// 'en' is the base content.json. Every other language is an overlay file in
// data/i18n/<code>.json holding only the translatable strings; anything missing
// falls back to the English base.
const DEFAULT_LANG = 'en';
const LANGUAGES = [
  { code: 'en', label: 'English',       short: 'EN' },
  { code: 'zh', label: '中文',          short: '中' },
  { code: 'ta', label: 'தமிழ்',         short: 'த' },
  { code: 'ms', label: 'Bahasa Melayu', short: 'MS' }
];
const LANG_CODES = LANGUAGES.map(l => l.code);
const isLang = (code) => LANG_CODES.includes(code);

// Fields shared across all languages — never translated, so they are hidden in
// the per-language admin editor and never written into an overlay file.
const NON_TRANSLATABLE_KEYS = new Set([
  'href', 'ctaLink', 'primaryBtnLink', 'secondaryBtnLink', 'btnLink',
  'mapQuery', 'phone', 'whatsapp', 'email', 'flip',
  'image', 'logo', 'buildingImage', 'favicon', 'address'
]);
const isTranslatableKey = (key) => !NON_TRANSLATABLE_KEYS.has(key);

// Deep-merge an overlay onto a base value. Arrays merge by index (so a
// translated card keeps the base card's image); objects merge by key;
// primitives are taken from the overlay when present.
function deepMerge(base, overlay) {
  if (overlay === undefined || overlay === null) return base;
  if (Array.isArray(base)) {
    if (!Array.isArray(overlay)) return base;
    return base.map((item, i) => deepMerge(item, overlay[i]));
  }
  if (base && typeof base === 'object') {
    if (typeof overlay !== 'object' || Array.isArray(overlay)) return base;
    const out = {};
    for (const k of Object.keys(base)) out[k] = deepMerge(base[k], overlay[k]);
    return out;
  }
  return overlay !== undefined ? overlay : base;
}

const overlayPath = (lang) => path.join(I18N_DIR, `${lang}.json`);
const loadOverlay = (lang) => readJSON(overlayPath(lang), {});
const saveOverlay = (lang, obj) => writeJSON(overlayPath(lang), obj);

// The content tree for a given language (English base merged with the overlay).
function localizedContent(lang) {
  const base = loadContent();
  if (!isLang(lang) || lang === DEFAULT_LANG) return base;
  return deepMerge(base, loadOverlay(lang));
}

// Resolve the visitor's language from ?lang=, then the `lang` cookie, else default.
function resolveLang(req) {
  const q = (req.query.lang || '').toLowerCase();
  if (isLang(q)) return q;
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)lang=([a-z]{2})/);
  if (m && isLang(m[1])) return m[1];
  return DEFAULT_LANG;
}

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

// Seed the live, admin-editable files from their *.default templates on first
// boot. The live files (content.json, i18n/<code>.json) are git-ignored and
// persist on the server, so admin edits survive deploys; a fresh checkout with
// no live files yet starts from the production copy shipped as templates.
function ensureContentSeed() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(I18N_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const seed = (live, template) => {
    if (!fs.existsSync(live) && fs.existsSync(template)) {
      fs.copyFileSync(template, live);
      console.log('  seeded ' + path.relative(__dirname, live) + ' from template');
    }
  };
  seed(CONTENT_FILE, path.join(DATA_DIR, 'content.default.json'));
  for (const code of LANG_CODES) {
    if (code === DEFAULT_LANG) continue;
    seed(overlayPath(code), path.join(I18N_DIR, `${code}.default.json`));
  }
}

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
// SEO: page registry + JSON-LD structured data
// ---------------------------------------------------------------------------
// Ordered list of standalone pages (home is '/'). Each has its SEO copy in
// content.pages[slug]; the first group are "service" pages that also emit
// Service schema.
const PAGE_ORDER = [
  'pet-cremation-singapore',
  'pet-columbarium-singapore',
  'pet-sea-scattering-singapore',
  'pet-celebrant-religious-services',
  'pricing',
  'about',
  'contact'
];
const SERVICE_SLUGS = new Set(PAGE_ORDER.slice(0, 4));
const LANG_HREF = (code) => (code === 'zh' ? 'zh-SG' : code);

const siteUrlOf = (c) => ((c.meta && c.meta.siteUrl) || 'https://enshrinepet.com.sg').replace(/\/$/, '');
const cleanTel = (s) => String(s || '').replace(/[^0-9+]/g, '');
const langSuffix = (path, code) => (code === 'en' ? '' : (path.indexOf('?') === -1 ? '?lang=' : '&lang=') + code);

function localBusinessSchema(c) {
  const site = siteUrlOf(c);
  return {
    '@context': 'https://schema.org',
    '@type': 'FuneralHome',
    '@id': site + '/#business',
    name: 'Enshrine Pets Afterlife Services 欣奉',
    url: site + '/',
    image: site + ((c.columbarium && c.columbarium.buildingImage) || '/images/building.jpg'),
    logo: site + ((c.meta && c.meta.logo) || '/images/logo.png'),
    telephone: cleanTel(c.contact && c.contact.phone),
    email: String((c.contact && c.contact.email) || '').trim().split(/\s+/)[0],
    address: {
      '@type': 'PostalAddress',
      streetAddress: '74 Lorong 6 Geylang',
      addressLocality: 'Singapore',
      addressCountry: 'SG'
    },
    areaServed: { '@type': 'Country', name: 'Singapore' }
  };
}

function pageSchema(c, slug, page) {
  const site = siteUrlOf(c);
  const blocks = [
    localBusinessSchema(c),
    {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: site + '/' },
        { '@type': 'ListItem', position: 2, name: page.crumb || page.h1, item: site + '/' + slug }
      ]
    }
  ];
  if (SERVICE_SLUGS.has(slug)) {
    blocks.push({
      '@context': 'https://schema.org', '@type': 'Service',
      name: page.h1, description: page.description, serviceType: page.h1,
      provider: { '@type': 'FuneralHome', name: 'Enshrine Pets Afterlife Services 欣奉', '@id': site + '/#business' },
      areaServed: { '@type': 'Country', name: 'Singapore' },
      url: site + '/' + slug
    });
  }
  if (page.faqs && page.faqs.length) {
    blocks.push({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: page.faqs.map(f => ({
        '@type': 'Question', name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: String(f.a || '').replace(/<[^>]+>/g, '').trim() }
      }))
    });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Public site
// ---------------------------------------------------------------------------
const setLangCookie = (req, res, lang) => {
  if (isLang((req.query.lang || '').toLowerCase())) {
    res.setHeader('Set-Cookie', `lang=${lang}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`);
  }
};

app.get('/', (req, res) => {
  const lang = resolveLang(req);
  setLangCookie(req, res, lang);
  const c = localizedContent(lang);
  res.render('index', {
    c, lang, languages: LANGUAGES,
    canonicalPath: '/', pageTitle: c.meta.title, pageDesc: c.meta.description,
    schema: [localBusinessSchema(c)]
  });
});

// robots.txt + XML sitemap (all pages × languages, with hreflang alternates)
app.get('/robots.txt', (req, res) => {
  const site = siteUrlOf(loadContent());
  res.type('text/plain').send(
    `User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${site}/sitemap.xml\n`
  );
});

app.get('/sitemap.xml', (req, res) => {
  const c = loadContent();
  const site = siteUrlOf(c);
  const paths = ['', ...PAGE_ORDER.filter(s => (c.pages || {})[s])];
  const url = (p, code) => site + '/' + p + langSuffix('/' + p, code);
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
  for (const p of paths) {
    for (const code of LANG_CODES) {
      xml += '  <url>\n    <loc>' + url(p, code) + '</loc>\n';
      for (const alt of LANG_CODES) {
        xml += '    <xhtml:link rel="alternate" hreflang="' + LANG_HREF(alt) + '" href="' + url(p, alt) + '"/>\n';
      }
      xml += '    <xhtml:link rel="alternate" hreflang="x-default" href="' + url(p, 'en') + '"/>\n  </url>\n';
    }
  }
  xml += '</urlset>\n';
  res.type('application/xml').send(xml);
});

// Standalone SEO pages — one focused keyword each. Unknown slugs fall through
// to the admin routes / 404 via next().
app.get('/:slug', (req, res, next) => {
  const slug = req.params.slug;
  const lang = resolveLang(req);
  const c = localizedContent(lang);
  const page = (c.pages || {})[slug];
  if (!page) return next();
  setLangCookie(req, res, lang);
  res.render('page', {
    c, lang, languages: LANGUAGES, slug, page,
    canonicalPath: '/' + slug, pageTitle: page.title, pageDesc: page.description,
    schema: pageSchema(c, slug, page)
  });
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
  const q = (req.query.lang || '').toLowerCase();
  const lang = isLang(q) ? q : DEFAULT_LANG;
  // English edits the base directly; other languages show the merged tree so
  // untranslated fields display their English value as a starting point.
  const c = lang === DEFAULT_LANG ? loadContent() : localizedContent(lang);
  res.render('admin', {
    c, isImageKey, isTranslatableKey,
    lang, languages: LANGUAGES, editLangLabel: (LANGUAGES.find(l => l.code === lang) || {}).label
  });
});

app.post('/admin/save', requireAuth, upload.any(), (req, res) => {
  const lang = isLang((req.body._lang || '').toLowerCase()) ? req.body._lang.toLowerCase() : DEFAULT_LANG;
  const SKIP = new Set(['_section', '_lang']);
  try {
    if (lang === DEFAULT_LANG) {
      // English — edit the base content (text fields + uploaded images).
      const content = loadContent();
      for (const [key, value] of Object.entries(req.body)) {
        if (SKIP.has(key)) continue;
        setPath(content, key, value);
      }
      for (const file of req.files || []) {
        setPath(content, file.fieldname, '/uploads/' + file.filename);
      }
      saveContent(content);
    } else {
      // Other language — write translated text into that language's overlay.
      // (Images and other shared fields are never posted in non-English mode.)
      const overlay = loadOverlay(lang);
      for (const [key, value] of Object.entries(req.body)) {
        if (SKIP.has(key)) continue;
        setPath(overlay, key, value);
      }
      saveOverlay(lang, overlay);
    }
    flash(req, 'success', 'Changes saved. Your website has been updated.');
  } catch (e) {
    console.error(e);
    flash(req, 'error', 'Something went wrong while saving: ' + e.message);
  }
  const langQuery = lang === DEFAULT_LANG ? '' : '?lang=' + lang;
  res.redirect('/admin' + langQuery + (req.body._section ? '#' + req.body._section : ''));
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
ensureContentSeed();
ensureUsers();
app.listen(PORT, () => {
  console.log(`\n  Enshrine website running:`);
  console.log(`    Public site : http://localhost:${PORT}/`);
  console.log(`    Admin panel : http://localhost:${PORT}/admin\n`);
});
