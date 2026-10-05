import { requireAuth } from '../../../../../lib/auth.js';
import { getPool } from '../../../../../lib/db.js';
import { errorResponse, jsonError } from '../../../../../lib/errors.js';
import { isValidUuid, validatePayment } from '../../../../../lib/validate.js';
import { recordPayment } from '../../../../../lib/repository.js';

export async function POST(request, { params }) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const { id } = params;
    if (!isValidUuid(id)) {
      return jsonError(404, 'loan_not_found', `No loan exists with id ${id}`);
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, 'invalid_json', 'Request body must be valid JSON');
    }
    const validation = validatePayment(body);
    if (!validation.ok) {
      return jsonError(400, 'invalid_input', 'Invalid payment data', validation.details);
    }
    const result = await recordPayment(getPool(), { loanId: id, ...validation.value });
    return Response.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
