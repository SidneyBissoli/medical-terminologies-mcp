import { describe, it, expect } from 'vitest';
import { plainTitle, icfComponent } from './icf.js';

describe('plainTitle (WHO search highlight markup)', () => {
  it('drops the <em class=found> markers the WHO search returns', () => {
    expect(plainTitle("<em class='found'>Walking</em> and moving")).toBe('Walking and moving');
  });

  it('leaves no tag behind on nested input (CodeQL incomplete sanitization case)', () => {
    const out = plainTitle('<<em>script>alert(1)<</em>/script>');
    expect(out).not.toMatch(/[<>]/);
  });
});

describe('icfComponent', () => {
  it('reads the component from the code letter', () => {
    expect(icfComponent('b280')).toBe('body_functions');
    expect(icfComponent('s7502')).toBe('body_structures');
    expect(icfComponent('D450')).toBe('activities_participation');
    expect(icfComponent('e1101')).toBe('environmental_factors');
  });

  it('is null without a code or with an unknown letter', () => {
    expect(icfComponent(null)).toBeNull();
    expect(icfComponent('5A11')).toBeNull();
  });
});
