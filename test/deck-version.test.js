import test from 'node:test';
import assert from 'node:assert/strict';
import { deckOutdated } from '../electron/deck-version.js';

test('deckOutdated: hanya bila plugin terpasang dan versinya lebih lama', () => {
  assert.equal(deckOutdated('1.0.0.0', '1.1.0.0'), true);
  assert.equal(deckOutdated('1.1.0.0', '1.1.0.0'), false);
  assert.equal(deckOutdated('1.10.0.0', '1.9.0.0'), false); // angka, bukan huruf
  assert.equal(deckOutdated(null, '1.1.0.0'), false); // belum pernah dipasang: tidak mengganggu
  assert.equal(deckOutdated('rusak', '1.1.0.0'), false);
});
