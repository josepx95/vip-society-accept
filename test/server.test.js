const test = require('node:test');
const assert = require('node:assert');
const { createServer } = require('../server');
const { sign } = require('../links');

const secret = 'test-secret';
const pi = 'pi_TEST0000000000000000000';

function fakeStripe() {
  const store = {};
  const calls = [];
  return {
    calls, store,
    getAnswer: async (id) => { calls.push(['get', id]); return store[id] || null; },
    setAnswer: async (id, answer) => { calls.push(['set', id, answer]); store[id] = answer; },
  };
}

async function withServer(opts, fn) {
  const srv = createServer(opts);
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base); } finally { srv.close(); }
}

test('a mail scanner merely opening the link records nothing', async () => {
  const stripe = fakeStripe();
  await withServer({ secret, stripe }, async (base) => {
    const res = await fetch(`${base}/r/${sign({ paymentIntent: pi, action: 'accept', secret })}`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /method="post"/);
    assert.equal(stripe.calls.length, 0, 'a plain visit must not touch Stripe');
  });
});

test('a vendor tap records the answer and says so', async () => {
  const stripe = fakeStripe();
  await withServer({ secret, stripe }, async (base) => {
    const res = await fetch(`${base}/r/${sign({ paymentIntent: pi, action: 'accept', secret })}`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /you&#39;re booked|you're booked/);
    assert.deepEqual(stripe.calls.at(-1), ['set', pi, 'accepted']);
  });
});

test('decline records declined', async () => {
  const stripe = fakeStripe();
  await withServer({ secret, stripe }, async (base) => {
    await fetch(`${base}/r/${sign({ paymentIntent: pi, action: 'decline', secret })}`, { method: 'POST' });
    assert.equal(stripe.store[pi], 'declined');
  });
});

test('an answer is final — tapping again, or tapping the other button, changes nothing', async () => {
  const stripe = fakeStripe();
  await withServer({ secret, stripe }, async (base) => {
    await fetch(`${base}/r/${sign({ paymentIntent: pi, action: 'accept', secret })}`, { method: 'POST' });
    const res = await fetch(`${base}/r/${sign({ paymentIntent: pi, action: 'decline', secret })}`, { method: 'POST' });
    assert.match(await res.text(), /Already answered/);
    assert.equal(stripe.store[pi], 'accepted');
    assert.equal(stripe.calls.filter((c) => c[0] === 'set').length, 1);
  });
});

test('a forged or garbage link is refused without touching Stripe', async () => {
  const stripe = fakeStripe();
  await withServer({ secret, stripe }, async (base) => {
    const forged = sign({ paymentIntent: pi, action: 'accept', secret: 'someone-else' });
    const res = await fetch(`${base}/r/${forged}`, { method: 'POST' });
    assert.equal(res.status, 400);
    assert.equal(stripe.calls.length, 0);
  });
});

test('an expired link says so and points to replying instead', async () => {
  await withServer({ secret, stripe: fakeStripe() }, async (base) => {
    const old = sign({ paymentIntent: pi, action: 'accept', secret, now: 0 });
    const res = await fetch(`${base}/r/${old}`, { method: 'POST' });
    assert.equal(res.status, 410);
    assert.match(await res.text(), /reply to the booking email/);
  });
});

test('without a Stripe key it refuses honestly rather than pretending', async () => {
  await withServer({ secret, stripe: null }, async (base) => {
    const res = await fetch(`${base}/r/${sign({ paymentIntent: pi, action: 'accept', secret })}`, { method: 'POST' });
    assert.equal(res.status, 503);
  });
});

test('health check reports whether it is ready', async () => {
  await withServer({ secret, stripe: null }, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { ok: true, ready: false });
  });
});
