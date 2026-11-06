// Fixture for test/repo/stagingInert.test.ts, not staged data: a 377 edition whose relative
// imports resolve nowhere under data/377/src/ must not break tsc or eslint.
import { nothing } from './no-such-module.js';

export const staged = nothing;
