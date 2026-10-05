import { requireAuth } from '../../../../lib/auth.js';
import { getPool } from '../../../../lib/db.js';
import { errorResponse, jsonError } from '../../../../lib/errors.js';
import { isValidUuid } from '../../../../lib/validate.js';
import { getLoan } from '../../../../lib/repository.js';

export async function GET(request, { params }) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const { id } = params;
    if (!isValidUuid(id)) {
      return jsonError(404, 'loan_not_found', `No loan exists with id ${id}`);
    }
    const loan = await getLoan(getPool(), id);
    return Response.json(loan);
  } catch (error) {
    return errorResponse(error);
  }
}
