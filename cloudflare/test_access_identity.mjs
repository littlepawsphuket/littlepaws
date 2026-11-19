import assert from 'node:assert/strict';
import {generateKeyPair, SignJWT} from 'jose';
import {accessEmail, accessIssuer, verifyAccessEmail} from './access_identity.mjs';

const issuer = 'https://example.cloudflareaccess.com';
const audience = 'test-audience';
const {privateKey, publicKey} = await generateKeyPair('RS256');
const sign = (claims = {}, key = privateKey) => new SignJWT({email: 'Owner@Example.com', ...claims})
  .setProtectedHeader({alg: 'RS256'}).setIssuer(issuer).setAudience(audience)
  .setSubject('test-owner').setIssuedAt().setExpirationTime('5m').sign(key);
const good = await sign();
assert.equal(await verifyAccessEmail(good, issuer, audience, publicKey), 'owner@example.com');
assert.equal(await verifyAccessEmail(good, issuer, 'another-app', publicKey), null);
assert.equal(await verifyAccessEmail(good, 'https://other.cloudflareaccess.com', audience, publicKey), null);
const other = await generateKeyPair('RS256');
assert.equal(await verifyAccessEmail(await sign({}, other.privateKey), issuer, audience, publicKey), null);
const expired = await new SignJWT({email:'owner@example.com'}).setProtectedHeader({alg:'RS256'})
  .setIssuer(issuer).setAudience(audience).setSubject('test-owner').setIssuedAt(1).setExpirationTime(2).sign(privateKey);
assert.equal(await verifyAccessEmail(expired, issuer, audience, publicKey), null);
assert.equal(await verifyAccessEmail(await sign({email:null}), issuer, audience, publicKey), null);
assert.equal(await verifyAccessEmail('x'.repeat(16385), issuer, audience, publicKey), null);
const parts = good.split('.');
parts[1] = Buffer.from(JSON.stringify({email:'attacker@example.com',iss:issuer,aud:audience,sub:'attacker',iat:1,exp:9999999999})).toString('base64url');
assert.equal(await verifyAccessEmail(parts.join('.'), issuer, audience, publicKey), null);
assert.equal(accessIssuer('https://example.cloudflareaccess.com.attacker.test'), null);
assert.equal(accessIssuer('http://example.cloudflareaccess.com'), null);
assert.equal(accessIssuer('https://example.cloudflareaccess.com/path'), null);
const spoof = new Request('https://staff.example/', {headers:{'Cf-Access-Authenticated-User-Email':'attacker@example.com'}});
assert.equal(await accessEmail(spoof, {}, undefined), null);
assert.equal(await accessEmail(spoof, {}, {email:'Owner@Example.com'}), 'owner@example.com');
console.log('Signed Access identity verification checks passed');
