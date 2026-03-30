// src/calendar/graphAuth.js
// Gestión de tokens OAuth2 para Microsoft Graph API (Client Credentials Flow).
// No requiere interacción de usuario — autenticación de aplicación (app-only).
//
// Variables de entorno requeridas:
//   MICROSOFT_TENANT_ID      — ID del tenant de Azure AD
//   MICROSOFT_CLIENT_ID      — ID de la aplicación registrada en Azure AD
//   MICROSOFT_CLIENT_SECRET  — Secret de la aplicación

const axios = require('axios');

let _token       = null;
let _tokenExpiry = 0;

/**
 * Devuelve un access token válido para Microsoft Graph.
 * Reutiliza el token en caché si aún no ha expirado (margen de 60 s).
 * @returns {Promise<string>}
 */
async function getAccessToken() {
  if (_token && Date.now() < _tokenExpiry - 60_000) return _token;

  const tenantId     = process.env.MICROSOFT_TENANT_ID;
  const clientId     = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      'Faltan credenciales Microsoft Graph. Configura MICROSOFT_TENANT_ID, ' +
      'MICROSOFT_CLIENT_ID y MICROSOFT_CLIENT_SECRET en .env'
    );
  }

  const url  = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'https://graph.microsoft.com/.default',
  });

  const res = await axios.post(url, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10_000,
  });

  _token       = res.data.access_token;
  _tokenExpiry = Date.now() + (res.data.expires_in * 1_000);

  console.log('🔑 [Graph] Token OAuth2 obtenido correctamente');
  return _token;
}

/** Invalida el token en caché (útil para forzar renovación ante 401). */
function invalidateToken() {
  _token       = null;
  _tokenExpiry = 0;
}

module.exports = { getAccessToken, invalidateToken };
