
export const userThemes = Object.freeze({
  '01bdb554-3b7f-4400-802b-e5ddd9b19457': 'rose',
  '712d76e1-9ebd-4f81-8298-8895bee0836a': 'blue',
});

export function themeFor(userId) {
  return ['blue', 'rose'].includes(userThemes[userId])
    ? userThemes[userId]
    : 'neutral';
}
