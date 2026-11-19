import {createRemoteJWKSet, jwtVerify} from 'jose';

let cachedIssuer;
let cachedKeys;

export function accessIssuer(value) {
  return typeof value === 'string' && /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(value) ? value : null;
}

export async function verifyAccessEmail(token, issuer, audience, keys) {
  if (!accessIssuer(issuer) || typeof audience !== 'string' || !audience || typeof token !== 'string' || token.length > 16384) return null;
  try {
    const {payload} = await jwtVerify(token, keys, {
      algorithms: ['RS256'], issuer, audience,
      requiredClaims: ['exp', 'iat', 'sub', 'email'],
    });
    return typeof payload.email === 'string' && payload.email.trim() && payload.email.length <= 320
      ? payload.email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

// Called only after the Worker's trusted ctx.access audience has matched.
// Some Access paths provide the audience but omit getIdentity() email.
// In that case verify the signed application JWT; never trust email headers.
export async function accessEmail(request, env, identity) {
  if (typeof identity?.email === 'string' && identity.email.trim()) return identity.email.trim().toLowerCase();
  const issuer = accessIssuer(env.ACCESS_TEAM_DOMAIN);
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!issuer || !token || token.length > 16384) return null;
  if (cachedIssuer !== issuer) {
    cachedIssuer = issuer;
    cachedKeys = createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs'), {timeoutDuration: 5000});
  }
  return verifyAccessEmail(token, issuer, env.ACCESS_AUDIENCE, cachedKeys);
}
