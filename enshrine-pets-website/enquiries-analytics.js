/**
 * Lead capture (enquiry form -> stored + shown in admin) and lightweight,
 * bot-filtered, self-hosted page-view analytics. No external accounts.
 * Storage: data/enquiries.json + data/analytics.json (both git-ignored).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function install(app, deps) {
  const { DATA_DIR, requireAuth, flash } = deps;
  const ENQ = path.join(DATA_DIR, 'enquiries.json');
  const ANA = path.join(DATA_DIR, 'analytics.json');
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const write = (f, o) => { try { fs.writeFileSync(f, JSON.stringify(o, null, 2)); } catch (e) { console.error('write', f, e.message); } };

  const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternal|headless|python-requests|curl|wget|semrush|ahrefs|dotbot|petalbot|gptbot|chatgpt|amazonbot|amzn|ccbot|claude|google-|yandex|baidu|duckduck|bytespider|meta-external/i;
  const isBot = (ua) => !ua || BOT.test(ua);
  const dayKey = () => new Date().toISOString().slice(0, 10);
  const clientIp = (req) => String(req.headers['x-real-ip'] || req.ip || '').replace(/^::ffff:/, '');
  const ipHash = (req) => crypto.createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 16);

  // ---- analytics: in-memory, flushed to disk periodically (low disk churn) ----
  let A = read(ANA, { days: {}, bots: 0 });
  if (!A.days) A = { days: {}, bots: 0 };
  let dirty = false;
  const flush = () => { if (dirty) { write(ANA, A); dirty = false; } };
  setInterval(flush, 15000).unref();
  process.on('SIGTERM', flush); process.on('SIGINT', flush); process.on('exit', flush);

  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    const p = req.path;
    const skip = p !== '/' && (/\.[a-z0-9]+$/i.test(p) || p.startsWith('/admin') || p === '/robots.txt' || p === '/sitemap.xml' || p === '/enquiry');
    if (skip) return next();
    const ua = req.headers['user-agent'] || '';
    if (isBot(ua)) { A.bots = (A.bots || 0) + 1; dirty = true; return next(); }
    const d = dayKey();
    const day = A.days[d] || (A.days[d] = { views: 0, paths: {}, ips: {} });
    day.views++;
    day.paths[p] = (day.paths[p] || 0) + 1;
    if (Object.keys(day.ips).length < 20000) day.ips[ipHash(req)] = 1;
    dirty = true;
    next();
  });

  // ---- public: enquiry submission (honeypot + validation + throttle) ----
  const lastByIp = Object.create(null);
  app.post('/enquiry', (req, res) => {
    const b = req.body || {};
    const back = (req.get('referer') || '/').slice(0, 500);
    const done = (type, msg, anchor) => { flash(req, type, msg); res.redirect(back.split('#')[0] + (anchor || '')); };
    if ((b.company || '').trim()) return done('success', 'Thank you — we will be in touch.'); // honeypot filled = bot
    const name = (b.name || '').trim(), contact = (b.contact || '').trim(), message = (b.message || '').trim();
    if (!name || !contact || !message) return done('error', 'Please fill in your name, a contact, and your message.', '#enquiry-form');
    const ipk = ipHash(req), now = Date.now();
    if (lastByIp[ipk] && now - lastByIp[ipk] < 20000) return done('success', 'Thank you — your message has been received.');
    lastByIp[ipk] = now;
    const list = read(ENQ, []);
    list.unshift({
      id: crypto.randomBytes(6).toString('hex'),
      name: name.slice(0, 200), contact: contact.slice(0, 200), message: message.slice(0, 4000),
      page: (b.page || back).slice(0, 300), ts: new Date().toISOString(), handled: false,
      ip: clientIp(req), ua: (req.headers['user-agent'] || '').slice(0, 300)
    });
    write(ENQ, list.slice(0, 5000));
    done('success', 'Thank you — your enquiry has been received. Our advisors will contact you shortly.', '#enquiry-form');
  });

  // ---- admin: enquiries ----
  app.get('/admin/enquiries', requireAuth, (req, res) => {
    const list = read(ENQ, []);
    res.render('enquiries', { list, newCount: list.filter(e => !e.handled).length });
  });
  app.post('/admin/enquiries/:id/handled', requireAuth, (req, res) => {
    const list = read(ENQ, []); const e = list.find(x => x.id === req.params.id);
    if (e) e.handled = !e.handled; write(ENQ, list); res.redirect('/admin/enquiries');
  });
  app.post('/admin/enquiries/:id/delete', requireAuth, (req, res) => {
    write(ENQ, read(ENQ, []).filter(x => x.id !== req.params.id));
    flash(req, 'success', 'Enquiry deleted.'); res.redirect('/admin/enquiries');
  });

  // ---- admin: traffic ----
  app.get('/admin/traffic', requireAuth, (req, res) => {
    flush();
    const days = Object.keys(A.days).sort().slice(-30).map(d => ({
      date: d, views: A.days[d].views, uniques: Object.keys(A.days[d].ips || {}).length
    }));
    const paths = {};
    for (const d of Object.keys(A.days)) for (const [p, n] of Object.entries(A.days[d].paths || {})) paths[p] = (paths[p] || 0) + n;
    const topPaths = Object.entries(paths).sort((x, y) => y[1] - x[1]).slice(0, 12);
    const totalHuman = days.reduce((s, d) => s + d.views, 0);
    res.render('traffic', { days, topPaths, bots: A.bots || 0, totalHuman });
  });
};
