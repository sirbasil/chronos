import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import {
  fetchAuthSession,
  getCurrentUser,
  signInWithRedirect,
  signOut as amplifySignOut,
  AuthUser,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { configureAmplify, isCognitoConfigured } from './amplifyConfig';

export type AuthStatus = 'LOADING' | 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'CONFIG_ERROR';

export interface UserProfile {
  sub: string;
  username: string;
  email?: string;
  groups?: string[];
}

export interface AuthContextType {
  status: AuthStatus;
  user: UserProfile | null;
  error: string | null;
  isConfigured: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Ensure Amplify is initialized before components evaluate
configureAmplify();

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>(() => {
    return isCognitoConfigured() ? 'LOADING' : 'CONFIG_ERROR';
  });
  const [user, setUser] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkAuthSession = useCallback(async () => {
    if (!isCognitoConfigured()) {
      setStatus('CONFIG_ERROR');
      setUser(null);
      return;
    }

    try {
      const session = await fetchAuthSession();
      if (!session.tokens?.accessToken) {
        setStatus('UNAUTHENTICATED');
        setUser(null);
        return;
      }

      let currentUser: AuthUser | null = null;
      try {
        currentUser = await getCurrentUser();
      } catch {
        // Fallback to token claims
      }

      const idPayload = session.tokens.idToken?.payload as Record<string, unknown> | undefined;
      const accessPayload = session.tokens.accessToken?.payload as Record<string, unknown> | undefined;

      const sub = (currentUser?.userId || idPayload?.sub || accessPayload?.sub || 'unknown') as string;
      const username = (currentUser?.username || idPayload?.['cognito:username'] || accessPayload?.username || sub) as string;
      const email = idPayload?.email as string | undefined;

      const rawGroups = (accessPayload?.['cognito:groups'] || idPayload?.['cognito:groups']) as unknown;
      let groups: string[] = [];
      if (Array.isArray(rawGroups)) {
        groups = rawGroups.map(String);
      } else if (typeof rawGroups === 'string') {
        groups = [rawGroups];
      }

      setUser({
        sub,
        username,
        email,
        groups,
      });
      setStatus('AUTHENTICATED');
      setError(null);
    } catch (err: unknown) {
      setStatus('UNAUTHENTICATED');
      setUser(null);
    }
  }, []);

  useEffect(() => {
    checkAuthSession();

    // Listen to Amplify Auth lifecycle events
    const unsubscribe = Hub.listen('auth', ({ payload }) => {
      switch (payload.event) {
        case 'signInWithRedirect':
        case 'signedIn':
        case 'tokenRefresh':
          checkAuthSession();
          break;
        case 'signedOut':
          setStatus('UNAUTHENTICATED');
          setUser(null);
          break;
        case 'signInWithRedirect_failure':
          setError('Sign-in redirect encountered an error. Please try again.');
          setStatus('UNAUTHENTICATED');
          break;
        default:
          break;
      }
    });

    return () => unsubscribe();
  }, [checkAuthSession]);

  const handleSignIn = useCallback(async () => {
    if (!isCognitoConfigured()) {
      setError('Cognito authentication is not configured in this environment.');
      return;
    }
    setError(null);
    try {
      await signInWithRedirect();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to redirect to sign-in';
      setError(msg);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await amplifySignOut();
      setStatus('UNAUTHENTICATED');
      setUser(null);
    } catch (err: unknown) {
      console.error('Sign-out error:', err);
      // Even if network fails, reset local state
      setStatus('UNAUTHENTICATED');
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        error,
        isConfigured: isCognitoConfigured(),
        signIn: handleSignIn,
        signOut: handleSignOut,
        refreshSession: checkAuthSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
