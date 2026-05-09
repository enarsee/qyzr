const ROOM_ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

function makeStringValidator({ key, max, allowEmpty = false }) {
  return (raw) => {
    if (typeof raw !== 'string') throw new Error(`${key}_invalid`);
    const trimmed = raw.trim();
    if (!trimmed && !allowEmpty) throw new Error(`${key}_required`);
    if (trimmed.length > max) throw new Error(`${key}_too_long`);
    return trimmed;
  };
}

const validateName = makeStringValidator({ key: 'name', max: 30 });
const validateGroupValue = makeStringValidator({ key: 'group_value', max: 10 });
const validateQuestionText = makeStringValidator({ key: 'question', max: 300 });
const validateOptionText = makeStringValidator({ key: 'option', max: 120 });

function validateSideTag(t) {
  if (typeof t !== 'string' || !['bride', 'groom', 'neutral'].includes(t)) {
    throw new Error('side_tag_invalid');
  }
  return t;
}

function validateRoomCode(raw) {
  if (typeof raw !== 'string') throw new Error('room_code_invalid');
  const upper = raw.toUpperCase();
  if (!ROOM_ALPHABET.test(upper)) throw new Error('room_code_invalid');
  return upper;
}

module.exports = {
  validateName,
  validateGroupValue,
  validateQuestionText,
  validateOptionText,
  validateSideTag,
  validateRoomCode
};
