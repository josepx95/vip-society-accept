# vip-society-accept

One-tap **Accept / Decline** for VIP Society vendor booking emails.

A vendor taps a button in their booking email; this service verifies the signed
link and records the answer on the booking's payment. Nothing else.

- Links are HMAC-signed, tied to one payment and one action, and expire after 14 days.
- A plain visit records nothing (mail scanners open links); the page confirms with a POST.
- An answer is final — a second tap, or the other button, changes nothing.

Environment: `LINK_SECRET`, `STRIPE_ANSWER_KEY` (restricted key, PaymentIntents: write).
No secrets live in this repository.

```
npm test
npm start
```
