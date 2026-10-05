import { requireAuth } from '../../../lib/auth.js';
import { getPool } from '../../../lib/db.js';
import { errorResponse, jsonError } from '../../../lib/errors.js';
import { validateCreateLoan } from '../../../lib/validate.js';
import { createLoan, listLoans } from '../../../lib/repository.js';

export async function POST(request) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, 'invalid_json', 'Request body must be valid JSON');
    }
    const validation = validateCreateLoan(body);
    if (!validation.ok) {
      return jsonError(400, 'invalid_input', 'Invalid loan data', validation.details);
    }
    const loan = await createLoan(getPool(), validation.value);
    return Response.json({ loanId: loan.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request) {
  const authError = await requireAuth(request);
  if (authError) return authError;

  try {
    const loans = await listLoans(getPool());
    return Response.json({ loans });
  } catch (error) {
    return errorResponse(error);
  }
}
