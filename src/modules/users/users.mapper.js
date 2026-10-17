// Define qué campos del usuario se exponen. Nunca se devuelve password_hash
// ni token_version (principio de mínima exposición de datos).
function toPublicUser(u) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    country: u.country,
    birthDate: u.birth_date,
    role: u.role,
    plan: u.plan_id,
    createdAt: u.created_at,
  };
}

module.exports = { toPublicUser };
