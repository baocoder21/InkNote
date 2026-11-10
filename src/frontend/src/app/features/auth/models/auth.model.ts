// Shapes of the JSON exchanged with the backend (see AuthDtos.cs).

export interface AuthUser {
  id: string;
  email: string;
}

/**
 * The answer of register / login / refresh. The refresh token is NOT here: it lives in an
 * HttpOnly cookie that JavaScript cannot read (only the browser sends it back).
 */
export interface AuthResponse {
  accessToken: string;
  expiresInSeconds: number;
  user: AuthUser;
}

export interface Credentials {
  email: string;
  password: string;
  // "Keep me signed in": true = stay signed in for days (also after closing the browser);
  // false = only until the browser is closed.
  rememberMe: boolean;
}

// Must match AuthLimits / the Identity password rule in the backend.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
