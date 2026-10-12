import test from 'node:test';
import assert from 'node:assert/strict';
import { changeMeetsThreshold, contributionMeetsTarget, exactSum } from './decimal.js';

test('decimal component sums avoid binary float residue', () => {
    assert.equal(exactSum(0.1, 0.2), 0.3); assert.equal(exactSum(4.01, 2.02, 0.4), 6.43);
    assert.equal(exactSum(1e-7, 2e-7), 3e-7); assert.equal(exactSum(4, -4), 0);
});
for (const [current, previous, threshold, expected] of [[9.45, 9, 5, true], [8.55, 9, 5, true],
    [104.999999999, 100, 5, false], [105.000000001, 100, 5, true], [105, 100, 5, true],
    [1, 0, 5, false], [0.3, 0.2, 50, true], [4, 4, 0.01, false]] as const) {
    test(`exact decimal change decision ${current}/${previous}/${threshold}`, () => {
        assert.equal(changeMeetsThreshold(current, previous, threshold, true), expected);
    });
}
test('cost increase threshold does not count a large decrease', () => assert.equal(changeMeetsThreshold(8.55, 9, 5), false));
test('exact contribution boundary is not falsely missed or rounded into a pass', () => {
    assert.equal(contributionMeetsTarget(9.45, [7.0875], [], 25), true);
    assert.equal(contributionMeetsTarget(9.45, [7.087500001], [], 25), false);
    assert.equal(contributionMeetsTarget(20, [6.5, 0.5, 1.5, 2], [10, 5, 5], 27.5), true);
    assert.equal(contributionMeetsTarget(20, [6.5, 0.5, 1.5, 2.000000001], [10, 5, 5], 27.5), false);
});
