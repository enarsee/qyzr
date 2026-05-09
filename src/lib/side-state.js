function computeSideStates(brideScore, groomScore) {
  const total = Math.max(brideScore + groomScore, 1);
  const ratio = (brideScore - groomScore) / total;

  if (ratio > 0.40) return { bride: 'winner', groom: 'angry' };
  if (ratio > 0.15) return { bride: 'happy', groom: 'sad' };
  if (ratio > -0.15) return { bride: 'neutral', groom: 'neutral' };
  if (ratio > -0.40) return { bride: 'sad', groom: 'happy' };
  return { bride: 'angry', groom: 'winner' };
}

module.exports = { computeSideStates };
