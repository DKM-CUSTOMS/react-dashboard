// Map user identifiers (email or id) to role arrays for quick manual control.
export const userRoleMap = {
  'anas.benabbou@dkm-customs.com': ['admin'],
  'luc.dekerf@dkm-customs.com': ['admin'],
  'taha.nghimi@dkm-customs.com': ['admin'],
  'ben.mansour@dkm-customs.com': ['admin'],
  'bjorn.vanacker@dkm-customs.com': ['manager'],
  'andy.paepen@dkm-customs.com': ['manager'],
  'kristof.ghys@dkm-customs.com': ['manager'],
  'hans.cuypers@dkm-customs.com': ['manager'],
  'chaimae.ejjari@dkm-customs.com': ['Arrivals Agent'],
  'amina.saiss@dkm-customs.com': ['Arrivals Agent']
};

// Roles automatically granted to any authenticated user.
export const defaultAuthenticatedRoles = ['authenticated', 'user'];