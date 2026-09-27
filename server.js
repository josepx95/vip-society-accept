/**
 * VIP Society — vendor Accept / Decline.
 *
 * One job: a vendor taps a button in their booking email and gets a page that
 * says "Got it". The answer is written onto the booking's Stripe payment as
 * metadata; the Mac's 5-minute watcher reads it there and carries on exactly as
 * it would for a typed reply. No database, no mail sending, nothing else here.
 *
 * Why a visit alone records NOTHING: mail security scanners (Outlook Safe Links
 * and friends) open every link in an email to check it. If a GET recorded the
 * answer, a scanner could accept a job the vendor never saw. So the GET page
 * confirms itself with a script-driven POST — one tap for a person, nothing
 * for a scanner that only fetches.
 *
 * Deterministic: the verification, the write, the refusal to answer twice.
 */
const http = require('node:http');
const { verify } = require('./links');

const PHONE = '(702) 219-7711';
const STRIPE = 'https://api.stripe.com/v1';

function stripeClient(key, fetchImpl = fetch) {
  const call = async (method, path, form) => {
    const res = await fetchImpl(`${STRIPE}/${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`stripe ${method} ${path} -> ${res.status} ${body.error && body.error.message}`);
    return body;
  };
  return {
    getAnswer: async (pi) => ((await call('GET', `payment_intents/${pi}`)).metadata || {}).vendor_answer || null,
    setAnswer: (pi, answer, at) => call('POST', `payment_intents/${pi}`, {
      'metadata[vendor_answer]': answer,
      'metadata[vendor_answered_at]': at,
    }),
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(title, message, extra = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>VIP Society — ${esc(title)}</title>
<style>
 body{margin:0;background:#f4f1ec;font-family:Montserrat,-apple-system,Helvetica,Arial,sans-serif;color:#1a1714}
 .bar{background:#0D0B08;border-bottom:2px solid #C9A84C;padding:18px 24px;color:#C9A84C;font-family:Georgia,serif;letter-spacing:.3em;font-size:14px}
 .card{max-width:460px;margin:40px auto;background:#fff;padding:32px 28px}
 h1{font-family:'Cormorant Garamond',Georgia,serif;font-weight:600;font-size:30px;margin:0 0 12px}
 p{font-size:15px;line-height:1.6;color:#4a443d;margin:0 0 14px}
 button{background:#0D0B08;color:#C9A84C;border:0;padding:13px 30px;font-size:13px;font-weight:700;letter-spacing:.1em;cursor:pointer}
 .small{font-size:12.5px;color:#8b837a}
</style></head><body><div class="bar">VIP SOCIETY</div>
<div class="card"><h1>${esc(title)}</h1><p>${message}</p>${extra}
<p class="small">Questions? Call or text ${PHONE}.</p></div></body></html>`;
}

const DONE = {
  accept: ["Got it — you're booked.", "Thanks. We'll be in touch with the client's details shortly."],
  decline: ['No problem.', "Thanks for letting us know — we'll take it from here."],
};

function createServer({ secret, stripe, now = () => new Date() }) {
  return http.createServer(async (req, res) => {
    const send = (status, html) => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
    };
    const url = new URL(req.url, 'http://x');

    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, ready: Boolean(secret && stripe) }));
    }

    const m = url.pathname.match(/^\/r\/([A-Za-z0-9_\-.]+)$/);
    if (!m) return send(404, page('Not found', "This link doesn't lead anywhere."));

    const v = verify({ token: m[1], secret });
    if (!v.ok) {
      const expired = v.why === 'link expired';
      return send(expired ? 410 : 400, page(expired ? 'This link has expired' : "This link isn't valid",
        'Just reply to the booking email with ACCEPT or DECLINE instead.'));
    }

    if (req.method === 'GET') {
      const verb = v.action === 'accept' ? 'Accepting' : 'Declining';
      return send(200, page(`${verb}…`, 'One moment.',
        `<form id="f" method="post"><noscript><button type="submit">CONFIRM ${v.action.toUpperCase()}</button></noscript></form>
<script>document.getElementById('f').submit()</script>`));
    }

    if (req.method !== 'POST') return send(405, page('Not allowed', 'Please use the button in your email.'));
    if (!stripe) return send(503, page('Briefly unavailable', 'Please reply to the booking email with ACCEPT or DECLINE instead.'));

    try {
      const existing = await stripe.getAnswer(v.paymentIntent);
      if (existing) {
        return send(200, page('Already answered', `This booking was already marked <b>${esc(existing)}</b>. If that's wrong, please call us.`));
      }
      const answer = v.action === 'accept' ? 'accepted' : 'declined';
      await stripe.setAnswer(v.paymentIntent, answer, now().toISOString());
      const [t, msg] = DONE[v.action];
      return send(200, page(t, msg));
    } catch (err) {
      console.error('[accept] could not record answer:', err.message);
      return send(502, page("That didn't go through", 'Nothing was recorded. Please reply to the booking email with ACCEPT or DECLINE instead.'));
    }
  });
}

module.exports = { createServer, stripeClient, page };

if (require.main === module) {
  const secret = process.env.LINK_SECRET;
  const key = process.env.STRIPE_ANSWER_KEY;
  if (!secret) console.error('LINK_SECRET is not set — every link will be refused');
  if (!key) console.error('STRIPE_ANSWER_KEY is not set — answers cannot be recorded');
  const port = process.env.PORT || 10000;
  createServer({ secret, stripe: key ? stripeClient(key) : null })
    .listen(port, () => console.log(`vip accept on :${port} — ${secret && key ? 'ready' : 'NOT READY'}`));
}
