import { Amplify } from 'aws-amplify';

export interface CognitoAuthConfig {
  region?: string;
  userPoolId?: string;
  userPoolClientId?: string;
  oauthDomain?: string;
  redirectSignIn?: string;
  redirectSignOut?: string;
}

/**
 * Resolves the list of valid OAuth redirect URIs for Amplify.
 * - In production: strictly uses the explicitly configured production redirect URLs.
 * - In local development: dynamically includes the active browser origin,
 *   the explicitly configured URL, and standard local development origins
 *   (Vite port 5173 on both localhost and 127.0.0.1).
 * All URIs are normalized with trailing slashes and deduplicated.
 */
export const resolveRedirectUrls = (configuredUrl?: string): string[] => {
  if (import.meta.env?.PROD) {
    if (configuredUrl) {
      return configuredUrl
        .split(',')
        .map((u) => u.trim())
        .filter(Boolean)
        .map((u) => (u.endsWith('/') ? u : `${u}/`));
    }
    return typeof window !== 'undefined' && window.location?.origin
      ? [`${window.location.origin}/`]
      : [];
  }

  const candidates: string[] = [];

  // 1. Current active window origin (highest priority for same-origin matching in browser)
  if (typeof window !== 'undefined' && window.location?.origin) {
    candidates.push(`${window.location.origin}/`);
  }

  // 2. Explicitly configured URL from environment variable (supports comma-separated values)
  if (configuredUrl) {
    const urls = configuredUrl
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    candidates.push(...urls);
  }

  // 3. Permitted local development loopbacks (Vite port 5173)
  candidates.push(
    'http://localhost:5173/',
    'http://127.0.0.1:5173/'
  );

  // Deduplicate and ensure trailing slash consistency
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const url of candidates) {
    const uri = url.endsWith('/') ? url : `${url}/`;
    if (!seen.has(uri)) {
      seen.add(uri);
      normalized.push(uri);
    }
  }

  return normalized;
};

export const getCognitoConfig = (): CognitoAuthConfig => {
  const configuredSignIn = import.meta.env?.VITE_COGNITO_REDIRECT_SIGN_IN;
  const configuredSignOut = import.meta.env?.VITE_COGNITO_REDIRECT_SIGN_OUT;
  const defaultLocalOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/`
      : 'http://localhost:5173/';

  return {
    region: import.meta.env?.VITE_COGNITO_REGION,
    userPoolId: import.meta.env?.VITE_COGNITO_USER_POOL_ID,
    userPoolClientId: import.meta.env?.VITE_COGNITO_USER_POOL_CLIENT_ID,
    oauthDomain: import.meta.env?.VITE_COGNITO_OAUTH_DOMAIN,
    redirectSignIn: configuredSignIn || defaultLocalOrigin,
    redirectSignOut: configuredSignOut || defaultLocalOrigin,
  };
};

export const isCognitoConfigured = (): boolean => {
  const cfg = getCognitoConfig();
  return Boolean(cfg.userPoolId && cfg.userPoolClientId && cfg.region);
};

let amplifyConfigured = false;

export const configureAmplify = (): boolean => {
  if (amplifyConfigured) return true;

  const cfg = getCognitoConfig();
  if (!isCognitoConfigured()) {
    return false;
  }

  // Strip https:// or http:// protocol and trailing slashes if passed
  const domain = (cfg.oauthDomain || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');

  const redirectSignInUrls = resolveRedirectUrls(cfg.redirectSignIn);
  const redirectSignOutUrls = resolveRedirectUrls(cfg.redirectSignOut);

  try {
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: cfg.userPoolId!,
          userPoolClientId: cfg.userPoolClientId!,
          loginWith: {
            oauth: {
              domain,
              scopes: ['openid', 'email', 'profile'],
              redirectSignIn: redirectSignInUrls,
              redirectSignOut: redirectSignOutUrls,
              responseType: 'code',
            },
          },
        },
      },
    });
    amplifyConfigured = true;
    return true;
  } catch (err) {
    console.error('Error initializing AWS Amplify Cognito configuration:', err);
    return false;
  }
};
