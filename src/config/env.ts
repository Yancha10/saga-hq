/** All deployment-specific values come from build-time env. No host names in application code. */
export const env = {
  name: (import.meta.env.VITE_ENV_NAME as string | undefined) ?? 'dev',
  googleClientId: (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '',
  e2eMocks: import.meta.env.VITE_E2E_MOCKS === '1',
  version: '0.1.0',
};

export function googleConfigured(): boolean {
  return env.googleClientId.length > 0 || env.e2eMocks;
}
