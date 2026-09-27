const test = require('node:test');
const assert = require('node:assert');
const { sign, verify, TTL_MS } = require('../links');
const secret = 'test-secret';
const pi = 'pi_TEST0000000000000000000';

test('a signed link verifies to its payment and action', () => {
  const r = verify({ token: sign({ paymentIntent: pi, action: 'accept', secret }), secret });
  assert.deepEqual(r, { ok: true, paymentIntent: pi, action: 'accept' });
});
test('an accept link cannot be edited into a decline', () => {
  const t = sign({ paymentIntent: pi, action: 'accept', secret });
  const [p, s] = t.split('.');
  const forged = Buffer.from(Buffer.from(p, 'base64url').toString().replace('accept', 'decline')).toString('base64url') + '.' + s;
  assert.equal(verify({ token: forged, secret }).ok, false);
});
test('a link signed with another secret is refused', () => {
  assert.equal(verify({ token: sign({ paymentIntent: pi, action: 'accept', secret: 'other' }), secret }).why, 'bad signature');
});
test('links expire after 14 days', () => {
  const t = sign({ paymentIntent: pi, action: 'accept', secret, now: 0 });
  assert.equal(verify({ token: t, secret, now: TTL_MS + 1 }).why, 'link expired');
});
test('garbage never throws', () => {
  for (const token of [undefined, '', 'x', 'a.b', '....']) assert.equal(verify({ token, secret }).ok, false);
});
test('no secret, no link', () => {
  assert.throws(() => sign({ paymentIntent: pi, action: 'accept', secret: '' }), /LINK_SECRET/);
});
