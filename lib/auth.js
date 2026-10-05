import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { jsonError } from './errors.js';

let adminApp = null;

function getFirebaseApp() {
  if (adminApp) return adminApp;
  const existing = getApps();
  if (existing.length > 0) {
    adminApp = existing[0];
    return adminApp;
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const options = { projectId };
  if (clientEmail && privateKey) {
    options.credential = cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    });
  }
  adminApp = initializeApp(options);
  return adminApp;
}

export async function verifyIdToken(token) {
  const auth = getAuth(getFirebaseApp());
  return auth.verifyIdToken(token);
}

export async function requireAuth(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return jsonError(401, 'unauthenticated', 'Authentication required. Sign in and send a Firebase ID token.');
  }
  try {
    await verifyIdToken(match[1]);
    return null;
  } catch (error) {
    return jsonError(401, 'invalid_token', 'The provided authentication token is invalid or expired.');
  }
}
