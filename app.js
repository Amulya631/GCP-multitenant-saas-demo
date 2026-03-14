const express = require('express');
const https = require('https');

const app = express();
app.use(express.json());

const PROJECT_ID = process.env.PROJECT_ID;

// Fetch Firebase public keys from JWKS endpoint
function getFirebasePublicKeys() {
  return new Promise((resolve, reject) => {
    https.get(
      'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(JSON.parse(data)));
      }
    ).on('error', reject);
  });
}

// Decode base64url
function base64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// Verify Firebase JWT manually using crypto
async function verifyFirebaseToken(token) {
  const crypto = require('crypto');
  const [headerB64, payloadB64, sigB64] = token.split('.');
  
  const header = JSON.parse(base64urlDecode(headerB64));
  const payload = JSON.parse(base64urlDecode(payloadB64));
  
  // Check expiry
  if (payload.exp < Date.now() / 1000) throw new Error('Token expired');
  
  // Check issuer
  if (payload.iss !== `https://securetoken.google.com/${PROJECT_ID}`) {
    throw new Error('Invalid issuer');
  }

  // Get public keys and verify signature
  const { keys } = await getFirebasePublicKeys();
  const key = keys.find(k => k.kid === header.kid);
  if (!key) throw new Error('No matching key found');

  const pubKey = crypto.createPublicKey({ key, format: 'jwk' });
  const data = `${headerB64}.${payloadB64}`;
  const sig = base64urlDecode(sigB64);
  
  const valid = crypto.verify('sha256', Buffer.from(data), pubKey, sig);
  if (!valid) throw new Error('Invalid signature');

  return payload;
}

// Quota tracker
const quotaMap = {};
function checkQuota(tenantId) {
  const now = Date.now();
  if (!quotaMap[tenantId]) quotaMap[tenantId] = { count: 0, reset: now + 60000 };
  if (now > quotaMap[tenantId].reset) quotaMap[tenantId] = { count: 0, reset: now + 60000 };
  quotaMap[tenantId].count++;
  return quotaMap[tenantId].count <= 100;
}

// Middleware
async function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(403).json({ error: 'Missing Bearer token' });
  }
  try {
    const payload = await verifyFirebaseToken(authHeader.split('Bearer ')[1]);
    req.tenantId = payload?.firebase?.tenant;
    if (!req.tenantId) return res.status(403).json({ error: 'No tenant in token' });
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token', detail: err.message });
  }
}

// Routes
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/', verifyJWT, (req, res) => {
  if (!checkQuota(req.tenantId)) {
    return res.status(429).json({ error: 'Quota exceeded (100 req/min)', tenant: req.tenantId });
  }
  res.json({
    message: 'SaaS app running',
    tenant: req.tenantId,
    firestorePath: `/tenants/${req.tenantId}/data`
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
