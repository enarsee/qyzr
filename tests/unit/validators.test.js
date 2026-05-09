const v = require('../../src/lib/validators');

describe('validateName', () => {
  test('trims and accepts 1-30 chars', () => {
    expect(v.validateName('  Alice ')).toBe('Alice');
  });
  test('rejects empty', () => {
    expect(() => v.validateName('   ')).toThrow('name_required');
  });
  test('rejects >30 chars', () => {
    expect(() => v.validateName('a'.repeat(31))).toThrow('name_too_long');
  });
  test('rejects non-string', () => {
    expect(() => v.validateName(123)).toThrow('name_invalid');
  });
});

describe('validateGroupValue', () => {
  test('accepts up to 10 chars', () => {
    expect(v.validateGroupValue('Table 7')).toBe('Table 7');
  });
  test('rejects empty', () => {
    expect(() => v.validateGroupValue('   ')).toThrow('group_value_required');
  });
  test('rejects >10 chars', () => {
    expect(() => v.validateGroupValue('a'.repeat(11))).toThrow('group_value_too_long');
  });
  test('rejects non-string', () => {
    expect(() => v.validateGroupValue(123)).toThrow('group_value_invalid');
  });
});

describe('validateQuestionText', () => {
  test('trims and accepts 1-300 chars', () => {
    expect(v.validateQuestionText('  How many ? ')).toBe('How many ?');
  });
  test('rejects empty', () => {
    expect(() => v.validateQuestionText('   ')).toThrow('question_required');
  });
  test('rejects >300 chars', () => {
    expect(() => v.validateQuestionText('a'.repeat(301))).toThrow('question_too_long');
  });
  test('rejects non-string', () => {
    expect(() => v.validateQuestionText(123)).toThrow('question_invalid');
  });
});

describe('validateOptionText', () => {
  test('trims and accepts 1-120 chars', () => {
    expect(v.validateOptionText('  Option A ')).toBe('Option A');
  });
  test('rejects empty', () => {
    expect(() => v.validateOptionText('   ')).toThrow('option_required');
  });
  test('rejects >120 chars', () => {
    expect(() => v.validateOptionText('a'.repeat(121))).toThrow('option_too_long');
  });
  test('rejects non-string', () => {
    expect(() => v.validateOptionText(123)).toThrow('option_invalid');
  });
});

describe('validateSideTag', () => {
  test('accepts known values', () => {
    for (const t of ['bride', 'groom', 'neutral']) {
      expect(v.validateSideTag(t)).toBe(t);
    }
  });
  test('rejects unknown', () => {
    expect(() => v.validateSideTag('partner')).toThrow('side_tag_invalid');
  });
  test('rejects non-string', () => {
    expect(() => v.validateSideTag(123)).toThrow('side_tag_invalid');
  });
});

describe('validateRoomCode', () => {
  test('upper-cases and validates 6 chars from alphabet', () => {
    expect(v.validateRoomCode('abc234')).toBe('ABC234');
  });
  test('rejects ambiguous chars (0, 1, I, O)', () => {
    expect(() => v.validateRoomCode('ABCDE0')).toThrow('room_code_invalid');
    expect(() => v.validateRoomCode('ABCDE1')).toThrow('room_code_invalid');
    expect(() => v.validateRoomCode('ABCDEI')).toThrow('room_code_invalid');
    expect(() => v.validateRoomCode('ABCDEO')).toThrow('room_code_invalid');
  });
  test('rejects non-6-char', () => {
    expect(() => v.validateRoomCode('ABCDE')).toThrow('room_code_invalid');
    expect(() => v.validateRoomCode('ABCDEF7')).toThrow('room_code_invalid');
  });
  test('rejects non-string', () => {
    expect(() => v.validateRoomCode(123)).toThrow('room_code_invalid');
  });
});
