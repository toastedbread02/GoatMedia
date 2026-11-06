/**
 * Creates or promotes the GoatMedia moderator account.
 *
 *   npm run admin:create -- --email you@example.com --username keeper
 *
 * A password is generated and printed once unless you pass --password.
 * Passing --promote promotes an existing account instead of failing.
 */
import { randomBytes } from 'node:crypto';
import readline from 'node:readline/promises';
import process from 'node:process';
import { get, run } from '../server/db.ts';
import { hashPassword } from '../server/auth.ts';
import { checkEmail, checkPassword, checkUsername } from '../server/util.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

if (has('help') || has('h')) {
  console.log(`
Usage: npm run admin:create -- [options]

  --email <address>        Sign-in email (required)
  --username <name>        Public username (required)
  --display-name <name>    Defaults to the username
  --password <password>    Omit to generate a strong one
  --promote                Give an existing account moderator rights
`);
  process.exit(0);
}

const tty = Boolean(process.stdin.isTTY);
const rl = tty ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
const ask = async (question: string) => (rl ? (await rl.question(question)).trim() : '');

let email = flag('email');
let username = flag('username');
const displayNameArg = flag('display-name');
let password = flag('password');
const promote = has('promote');

if (!email && tty) email = await ask('Email: ');
if (!username && tty) username = await ask('Username: ');
if (!password && tty && !promote) {
  const typed = await ask('Password (leave blank to generate one): ');
  if (typed) password = typed;
}
rl?.close();

if (!email || !username) {
  console.error('Email and username are required. Use --email and --username, or run interactively.');
  process.exit(1);
}

const checkedEmail = checkEmail(email);
if (checkedEmail.error) {
  console.error(`Email: ${checkedEmail.error}`);
  process.exit(1);
}
const checkedUsername = checkUsername(username);
if (checkedUsername.error) {
  console.error(`Username: ${checkedUsername.error}`);
  process.exit(1);
}

const generated = !password;
if (!password) {
  password = `gm-${randomBytes(12).toString('base64url')}`;
}
if (password.length < 12) {
  console.error('Administrator passwords need at least 12 characters.');
  process.exit(1);
}
if (checkPassword(password)) {
  console.error(checkPassword(password) ?? 'Choose a stronger password.');
  process.exit(1);
}

const existing = get<{ id: string; role: string; email: string }>(
  `SELECT id, role, email FROM users WHERE lower(email) = ? OR lower(username) = ?`,
  checkedEmail.email,
  checkedUsername.username,
);

const passwordHash = await hashPassword(password);
const now = Date.now();

if (existing) {
  if (!promote) {
    console.error(
      `An account already uses that email or username (${existing.email}). ` +
        'Pass --promote to give it moderator rights and reset its password.',
    );
    process.exit(1);
  }
  run(
    `UPDATE users SET role = 'admin', status = 'active', suspended_reason = NULL, password_hash = ? WHERE id = ?`,
    passwordHash,
    existing.id,
  );
  run(`DELETE FROM sessions WHERE user_id = ?`, existing.id);
  console.log(`\nPromoted existing account to moderator and reset its password.`);
} else {
  run(
    `INSERT INTO users (id, email, username, display_name, bio, password_hash, role, status, created_at)
     VALUES (?, ?, ?, ?, '', ?, 'admin', 'active', ?)`,
    crypto.randomUUID(),
    checkedEmail.email,
    checkedUsername.username,
    displayNameArg || checkedUsername.username,
    passwordHash,
    now,
  );
  console.log(`\nCreated moderator @${checkedUsername.username}.`);
}

console.log(`Email:    ${checkedEmail.email}`);
if (generated) {
  console.log(`Password: ${password}`);
  console.log('\nThis password is shown once. Store it in a password manager now.');
} else {
  console.log('Password: the value you supplied');
}
console.log('Sign in at /login, then open /admin.');
