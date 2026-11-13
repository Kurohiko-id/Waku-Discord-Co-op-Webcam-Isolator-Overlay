import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyMatch } from '../public/shared/fuzzy.js';

test('fuzzyMatch: tahan typo, spasi, huruf besar, awal kata', () => {
  for (const [q, t] of [['pskingame', 'PSK IN GAME'], ['psk in game', 'PSK IN GAME'], ['orng', '10 ORANG'], ['10 orng', '10 ORANG'],
    ['freetlak', 'P5 FREETALK'], ['val', 'Duo Valo'], ['duo valo', 'Duo Valo'], ['', 'apa saja'], ['squd', 'Squad 4']])
    assert.ok(fuzzyMatch(q, t), q + ' -> ' + t);
  for (const [q, t] of [['xyz', 'PSK IN GAME'], ['p9', 'P8'], ['solo', 'Squad 4'], ['valorant', 'Duo Valo']])
    assert.ok(!fuzzyMatch(q, t), q + ' !-> ' + t);
});
