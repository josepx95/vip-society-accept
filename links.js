/**
 * Signed Accept / Decline links.
 *
 * A link names one payment and one action and nothing else, and is signed with
 * a secret only this service and the Mac share. So a link cannot be edited into
 * the other answer, pointed at another booking, or made up from scratch. It
 * never names a recipient either: whatever happens after a tap, the client's
 * details still go only to the vendor on file.
 *
 * Deterministic: all of it.
 */
const crypto = require('node:crypto');

const ACTIONS = new Set(['accept', 'decline']);
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');
const mac = (secret, payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

function sign({ paymentIntent, action, secret, now = Date.now() }) {
  if (!secret) throw new Error('LINK_SECRET is not set — refusing to make an unsigned link');
  if (!/^pi_[A-Za-z0-9]+$/.test(String(paymentIntent || ''))) throw new Error(`not a payment intent id: ${paymentIntent}`);
  if (!ACTIONS.has(action)) throw new Error(`unknown action: ${action}`);
  const payload = `${paymentIntent}.${action}.${now + TTL_MS}`;
  return `${b64(payload)}.${mac(secret, payload)}`;
}

/** Returns { ok: true, paymentIntent, action } or { ok: false, why }. Never throws. */
function verify({ token, secret, now = Date.now() }) {
  if (!secret) return { ok: false, why: 'server has no LINK_SECRET' };
  const [p, sig] = String(token || '').split('.');
  if (!p || !sig) return { ok: false, why: 'malformed link' };
  let payload;
  try { payload = unb64(p); } catch { return { ok: false, why: 'malformed link' }; }
  const want = Buffer.from(mac(secret, payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return { ok: false, why: 'bad signature' };
  const [paymentIntent, action, exp] = payload.split('.');
  if (!ACTIONS.has(action)) return { ok: false, why: 'unknown action' };
  if (!(Number(exp) > now)) return { ok: false, why: 'link expired' };
  return { ok: true, paymentIntent, action };
}

module.exports = { sign, verify, TTL_MS };
