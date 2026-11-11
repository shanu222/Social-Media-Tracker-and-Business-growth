// Prints fresh random secrets to paste into Railway → Variables.
// Never commit the output.
import crypto from 'node:crypto';

console.log(`JWT_SECRET=${crypto.randomBytes(48).toString('base64url')}`);
console.log(`ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}`);
console.log('\nStore ENCRYPTION_KEY somewhere safe (e.g. your password manager).');
console.log('If it is lost, encrypted fields and cloud backups cannot be decrypted.');
