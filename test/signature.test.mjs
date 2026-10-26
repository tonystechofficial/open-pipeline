// The proofs the public intake checks: Cal.com's signature, and a shared secret.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyHmacSha256, safeEqual } from '../src/core/signature.mjs';

const BODY = '{"triggerEvent":"BOOKING_CREATED","payload":{"uid":"bk_1"}}';
const sign = (secret, body) => createHmac('sha256', secret).update(body).digest('hex');

test("Cal.com's x-cal-signature-256 is the HMAC-SHA256 of the raw body, in hex", async () => {
  assert.equal(await verifyHmacSha256('s3cret', BODY, sign('s3cret', BODY)), true);
  assert.equal(await verifyHmacSha256('s3cret', BODY, sign('s3cret', BODY).toUpperCase()), true);
});

test('another secret, another body or no signature at all is refused', async () => {
  assert.equal(await verifyHmacSha256('s3cret', BODY, sign('other', BODY)), false);
  assert.equal(await verifyHmacSha256('s3cret', `${BODY} `, sign('s3cret', BODY)), false);
  assert.equal(await verifyHmacSha256('s3cret', BODY, null), false);
  assert.equal(await verifyHmacSha256('', BODY, sign('', BODY)), false); // no secret set: nothing is trusted
});

test('secrets are compared in constant time, and an empty one never matches', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual(undefined, 'abc'), false);
});
