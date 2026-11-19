import assert from 'node:assert/strict';
import { deductedCredits, multiplierFromDecimal } from '@rexu/shared';

assert.equal(multiplierFromDecimal(1), 10_000);
assert.equal(multiplierFromDecimal(2), 20_000);
assert.equal(multiplierFromDecimal(1.5), 15_000);
assert.equal(deductedCredits(1000, 20_000), 2);
assert.equal(deductedCredits(1001, 15_000), 2);
assert.equal(deductedCredits(1000, 20_000, 12_000), 3);
assert.equal(deductedCredits(0, 10_000), 0);
assert.equal(deductedCredits(1, 10_000), 1);
assert.equal(deductedCredits(40_000, 10_000), 40);
assert.throws(() => deductedCredits(-1, 10_000));
assert.throws(() => deductedCredits(1, -1));
assert.throws(() => deductedCredits(1, 10_000, 0));

console.log('billing math ok');
