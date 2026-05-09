const { computeSideStates } = require('../../src/lib/side-state');

describe('computeSideStates', () => {
  test('zero/zero -> neutral/neutral', () => {
    expect(computeSideStates(0, 0)).toEqual({ bride: 'neutral', groom: 'neutral' });
  });

  test('bride leads big -> winner/angry', () => {
    // 8-2 of 10 -> ratio 0.6
    expect(computeSideStates(8, 2)).toEqual({ bride: 'winner', groom: 'angry' });
  });

  test('bride leads small -> happy/sad', () => {
    // 6-4 of 10 -> ratio 0.2
    expect(computeSideStates(6, 4)).toEqual({ bride: 'happy', groom: 'sad' });
  });

  test('groom leads small -> sad/happy', () => {
    expect(computeSideStates(4, 6)).toEqual({ bride: 'sad', groom: 'happy' });
  });

  test('groom leads big -> angry/winner', () => {
    expect(computeSideStates(2, 8)).toEqual({ bride: 'angry', groom: 'winner' });
  });

  test('within neutral band', () => {
    // 10-9 of 19 -> ratio ~0.05 -> neutral
    expect(computeSideStates(10, 9)).toEqual({ bride: 'neutral', groom: 'neutral' });
  });

  test('boundary at 0.15 strict', () => {
    // 23-17 of 40 -> ratio 0.15 exactly: per spec uses '> 0.15' so 0.15 is neutral
    expect(computeSideStates(23, 17)).toEqual({ bride: 'neutral', groom: 'neutral' });
  });

  test('boundary just above 0.15', () => {
    // 24-17 of 41 -> ratio ~0.171 -> happy/sad
    expect(computeSideStates(24, 17)).toEqual({ bride: 'happy', groom: 'sad' });
  });
});
