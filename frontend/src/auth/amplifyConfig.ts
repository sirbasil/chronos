import { Amplify } from 'aws-amplify';

export interface CognitoAuthConfig {
  region?: string;
  userPoolId?: string;
  userPoolClientId?: string;
  oauthDomain?: string;
  redirectSignIn?: string;
  redirectSignOut?: string;
}

export const getCognitoConfig = (): CognitoAuthConfig => ({
  region: import.meta.env?.VITE_COGNITO_REGION,
  userPoolId: import.meta.env?.VITE_COGNITO_USER_POOL_ID,
  userPoolClientId: import.meta.env?.VITE_COGNITO_USER_POOL_CLIENT_ID,
  oauthDomain: import.meta.env?.VITE_COGNITO_OAUTH_DOMAIN,
  redirectSignIn:
    import.meta.env?.VITE_COGNITO_REDIRECT_SIGN_IN ||
    (typeof window !== 'undefined' ? `${window.location.origin}/` : 'http://127.0.0.1:5173/'),
  redirectSignOut:
    import.meta.env?.VITE_COGNITO_REDIRECT_SIGN_OUT ||
    (typeof window !== 'undefined' ? `${window.location.origin}/` : 'http://127.0.0.1:5173/'),
});

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
              redirectSignIn: [cfg.redirectSignIn!],
              redirectSignOut: [cfg.redirectSignOut!],
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
