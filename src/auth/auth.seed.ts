/**
 * ============================================================
 *  AUTH SEED FILE — ADD ADMINS AND USERS HERE
 * ============================================================
 *
 *  This is the file you edit to add accounts. Two buckets:
 *
 *  - SEED_ADMINS → created with role `admin`
 *  - SEED_USERS  → created with role `user`
 *
 *  Applied on every backend start (see auth-seed.service.ts).
 *
 *  HOW UPDATES WORK
 *  ----------------
 *  By default an entry only CREATES the account when it is missing.
 *  After that the admin panel owns it: usernames, passwords, active
 *  status and session expiry changed there survive a restart.
 *
 *  Set `sync_on_restart: true` on an entry when the file must win
 *  on every restart. Use it to force a known password (recovery /
 *  "I forgot the password") or to re-enable a deactivated account.
 *  While that flag is set, admin-panel changes are overwritten on
 *  the next start — remove the flag once the account is healthy.
 *
 *  PASSWORD RULES (same ones the API enforces for UI edits):
 *    - at least 8 characters
 *    - at least 1 uppercase letter
 *    - at least 1 lowercase letter
 *    - at least 1 number OR 1 special character
 *
 *  NOTE: changing an entry's `username` creates a NEW account; the
 *  old one is not renamed or deleted.
 * ============================================================
 */

export interface SeedUser {
  /** Unique login name. */
  username: string;
  /** Plain-text password. Hashed with bcrypt (12 rounds) on startup. */
  password: string;
  /** Optional email. */
  email?: string;
  /**
   * When true the file overwrites password/email/role/active status on
   * every restart. Default false = create-only, admin panel wins.
   */
  sync_on_restart?: boolean;
}

/**
 * ADMINS — created with role `admin`.
 * Editable in the admin panel unless `sync_on_restart` is true.
 */
export const SEED_ADMINS: SeedUser[] = [
  {
    username: 'admin',
    password: 'Admin@12345',
    email: 'admin@crypto.local',
  },
  // {
  //   username: 'second-admin',
  //   password: 'AnotherAdmin@123',
  //   email: 'admin2@crypto.local',
  //   // Uncomment to force these credentials on every restart:
  //   // sync_on_restart: true,
  // },
];

/**
 * USERS — created with role `user`.
 * Editable in the admin panel unless `sync_on_restart` is true.
 */
export const SEED_USERS: SeedUser[] = [
  // {
  //   username: 'demo',
  //   password: 'Demo@12345',
  //   email: 'demo@crypto.local',
  // },
];
