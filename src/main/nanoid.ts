import { randomBytes } from 'crypto';

export function nanoid(): string {
  return randomBytes(12).toString('base64url');
}
