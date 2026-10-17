const { z } = require('zod');

// Esquema reutilizable para ?page=&limit=. El límite máximo evita que un
// cliente pida miles de registros de golpe (protección contra abuso).
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

function paginate({ page, limit }) {
  return { limit, offset: (page - 1) * limit };
}

function pageResponse(items, total, { page, limit }) {
  return {
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

module.exports = { paginationSchema, paginate, pageResponse };
