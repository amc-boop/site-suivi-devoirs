// Mots de passe (scrypt + sel aléatoire)
import crypto from 'node:crypto';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = crypto.scryptSync(pw, salt, 32), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Mot de passe facile à taper sur un téléphone, ex. « pomme-vague-38-lune »
const WORDS = ['pomme', 'vague', 'lune', 'tigre', 'nuage', 'piano', 'sable', 'rocher', 'citron', 'orage', 'plume', 'cactus', 'fusee', 'jungle', 'ocean', 'volcan', 'comete', 'renard', 'abeille', 'cerise'];
export const randomPassword = () => {
  const w = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${w()}-${w()}-${crypto.randomInt(10, 100)}-${w()}`;
};
