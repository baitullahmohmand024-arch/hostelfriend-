import { auth } from './firebase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function formatUserFriendlyError(
  error: unknown,
  fallback = 'Something went wrong. Please try again.'
): string {
  if (!(error instanceof Error)) return fallback;
  const raw = error.message || '';

  // Parse structured FirestoreErrorInfo JSON thrown by handleFirestoreError
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw) as Partial<FirestoreErrorInfo>;
      const inner = parsed.error || '';
      if (inner.toLowerCase().includes('permission') || inner.toLowerCase().includes('insufficient')) {
        return 'Permission denied by Firestore rules. Ensure your account is verified and the latest firestore.rules are published to your Firebase project.';
      }
      if (inner.toLowerCase().includes('offline') || inner.toLowerCase().includes('network')) {
        return 'Unable to reach the database. Please check your internet connection.';
      }
      if (inner) return inner;
    } catch {
      // Fall through to standard message checks
    }
  }

  if (raw.toLowerCase().includes('missing or insufficient permissions')) {
    return 'You do not have permission to access this resource. Please refresh or sign in again.';
  }

  return raw || fallback;
}

export function isPermissionDeniedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (code === 'permission-denied' || code === 'firestore/permission-denied') {
    return true;
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown }).message === 'string'
        ? String((error as { message?: unknown }).message)
        : '';
  const lower = message.toLowerCase();
  return (
    lower.includes('missing or insufficient permissions') ||
    lower.includes('permission-denied') ||
    lower.includes('permission denied')
  );
}
