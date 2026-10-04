import type { Pool } from 'mysql2/promise';
import { logger } from '../lib/logger.js';

/**
 * One-off data fixes that a CREATE TABLE IF NOT EXISTS schema cannot express.
 *
 * The second user was seeded as `friend` and is now `zaur`. Editing SEED_USERS alone would NOT
 * rename it: seedUsers upserts on `username`, so a new `zaur` row would be inserted and the old
 * `friend` row would survive — leaving three users, with every playlist `friend` owns still
 * attributed to a name nobody recognises. Renaming the row in place keeps the id, so playlists,
 * playlist_items, shares and notifications all stay attached to the same person.
 *
 * Runs before seedUsers, and is idempotent: a renamed row no longer matches the old username.
 */
const USER_RENAMES: { from: string; to: string; displayName: string }[] = [
  { from: 'friend', to: 'zaur', displayName: 'Zaur' },
];

export async function migrateLibraryUsers(pool: Pool): Promise<void> {
  for (const { from, to, displayName } of USER_RENAMES) {
    const [oldRows] = (await pool.query('SELECT id FROM users WHERE username=? LIMIT 1', [from])) as unknown as [
      { id: number }[],
      unknown,
    ];
    // Nothing to rename — the common case on a fresh install, and after a rename has already run.
    // Checked before the collision case so a clean boot does not log a scary "already taken".
    if (!oldRows.length) continue;

    // Refuse to rename into an occupied name. Two rows sharing a username would violate
    // uq_users_username and take the whole boot down, and "skip loudly" beats that.
    const [taken] = (await pool.query('SELECT id FROM users WHERE username=? LIMIT 1', [to])) as unknown as [
      { id: number }[],
      unknown,
    ];
    if (taken.length) {
      logger.log('library: user rename skipped — target name already taken', { from, to, heldBy: taken[0].id });
      continue;
    }

    const [res] = (await pool.query('UPDATE users SET username=?, display_name=? WHERE username=?', [
      to,
      displayName,
      from,
    ])) as unknown as [{ affectedRows: number }, unknown];

    logger.log('library: user renamed in place', { from, to, id: oldRows[0].id, rows: res.affectedRows });
  }
}
