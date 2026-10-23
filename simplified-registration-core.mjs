export const PERSONAL_PROFILE_FIELDS = ['first_name', 'last_name', 'whatsapp', 'birth_date', 'city'];

export function profileUpdatePayload(profileValues, form) {
  const { stage: _stage, ...payload } = profileValues;
  for (const field of PERSONAL_PROFILE_FIELDS) {
    if (form.has(field)) payload[field] = String(form.get(field) || '').trim();
  }
  return payload;
}

export function healthScreeningPayload(userId, form) {
  const answers = {};
  for (let index = 1; index <= 10; index += 1) {
    const answer = form.get(`q${index}`);
    if (answer !== 'yes' && answer !== 'no') throw new Error('missing_health_answer');
    answers[`q${index}`] = answer === 'yes';
  }
  return {
    user_id: userId,
    answers,
    medical_review_recommended: Object.values(answers).some(Boolean)
  };
}
