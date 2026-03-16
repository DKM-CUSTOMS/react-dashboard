// src/utils/getUser.js
import { userRoleMap, defaultAuthenticatedRoles } from './roleConfig';

const roleClaimTypes = [
  'roles',
  'role',
  'http://schemas.microsoft.com/ws/2008/06/identity/claims/role',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/role',
];

async function getDbRoles() {
  try {
    const res = await fetch('/api/user-roles/me');
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.roles) ? data.roles : [];
  } catch {
    return [];
  }
}

export async function getUser() {
  const isDev = import.meta.env.DEV;
  const url = isDev ? '/.auth/me.json' : '/.auth/me';

  try {
    const res = await fetch(url);

    if (!res.ok) throw new Error('User not authenticated');
    const data = await res.json();
    const claims = data[0]?.user_claims || [];

    const name = claims.find(c => c.typ === 'name')?.val || '';
    const email = data[0]?.user_id || '';
    const id = data[0]?.id_token || '';

    const rolesFromClaims = claims
      .filter(c => roleClaimTypes.includes(c.typ))
      .flatMap(c => {
        if (Array.isArray(c.val)) return c.val;
        if (typeof c.val === 'string') return c.val.split(',');
        return [];
      })
      .map(r => r.trim())
      .filter(Boolean);

    // DB roles (primary source) — fall back to roleConfig.js if empty
    const dbRoles = await getDbRoles();
    const fallbackRoles = dbRoles.length > 0 ? [] : (userRoleMap[email?.toLowerCase()] || []);

    const roles = Array.from(
      new Set([...(defaultAuthenticatedRoles || []), ...rolesFromClaims, ...dbRoles, ...fallbackRoles]),
    );

    return { name, email, id, roles };
  } catch (err) {
    return null;
  }
}