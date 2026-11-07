/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_COGNITO_REGION?: string;
  readonly VITE_COGNITO_USER_POOL_ID?: string;
  readonly VITE_COGNITO_USER_POOL_CLIENT_ID?: string;
  readonly VITE_COGNITO_OAUTH_DOMAIN?: string;
  readonly VITE_COGNITO_REDIRECT_SIGN_IN?: string;
  readonly VITE_COGNITO_REDIRECT_SIGN_OUT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
