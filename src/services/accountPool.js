/**
 * Multi-Account Rotation & Pool Manager
 * Distributes dispatch load across 10 to 40+ sender accounts
 * Enforces per-account cooldowns and rolling 24-hour daily quotas
 */

const db = require('../db');

class AccountPool {
  /**
   * Selects the next available sender account based on fair round-robin,
   * quota availability, and cooldown compliance.
   * @returns {Object|null} account record or null if all accounts are throttled/exhausted
   */
  static getAvailableAccount() {
    this.refreshRollingQuotas();

    const stmt = db.prepare(`
      SELECT * FROM accounts
      WHERE is_active = 1
        AND sent_today < daily_limit
        AND (
          last_sent_at IS NULL
          OR (strftime('%s', 'now') - strftime('%s', last_sent_at)) >= cooldown_seconds
        )
      ORDER BY last_sent_at ASC
      LIMIT 1
    `);

    return stmt.get() || null;
  }

  /**
   * Resets sent_today counters for accounts whose 24-hour rolling window has rolled over
   */
  static refreshRollingQuotas() {
    // Count sends in the last 24 hours per account from queue table
    const stmt = db.prepare(`
      UPDATE accounts
      SET sent_today = (
        SELECT COUNT(*)
        FROM queue
        WHERE queue.account_id = accounts.id
          AND queue.status = 'sent'
          AND queue.sent_at >= datetime('now', '-24 hours')
      )
    `);
    stmt.run();
  }

  /**
   * Records a successful dispatch for an account
   * @param {number} accountId
   */
  static recordSendSuccess(accountId) {
    const stmt = db.prepare(`
      UPDATE accounts
      SET sent_today = sent_today + 1,
          last_sent_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(accountId);
  }

  /**
   * Temporarily puts an account into cooldown (e.g. after a 429 throttle)
   * @param {number} accountId
   * @param {number} cooldownSeconds
   */
  static putOnCooldown(accountId, cooldownSeconds = 120) {
    const stmt = db.prepare(`
      UPDATE accounts
      SET last_sent_at = datetime('now'),
          cooldown_seconds = MAX(cooldown_seconds, ?)
      WHERE id = ?
    `);
    stmt.run(cooldownSeconds, accountId);
  }

  /**
   * Adds or updates a sender account in the pool
   * @param {Object} account
   */
  static upsertAccount({ email, displayName, provider = 'GRAPH_API', dailyLimit = 500, cooldownSeconds = 60 }) {
    const stmt = db.prepare(`
      INSERT INTO accounts (email, display_name, provider, daily_limit, cooldown_seconds, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(email) DO UPDATE SET
        display_name = excluded.display_name,
        provider = excluded.provider,
        daily_limit = excluded.daily_limit,
        cooldown_seconds = excluded.cooldown_seconds,
        is_active = 1
    `);
    stmt.run(email.toLowerCase().trim(), displayName, provider, dailyLimit, cooldownSeconds);
  }

  /**
   * Returns list of all accounts with live telemetry
   */
  static getAllAccounts() {
    this.refreshRollingQuotas();
    const stmt = db.prepare(`
      SELECT 
        id, email, display_name, provider, daily_limit, sent_today,
        last_sent_at, cooldown_seconds, is_active,
        MAX(0, daily_limit - sent_today) AS remaining_today,
        CASE 
          WHEN last_sent_at IS NULL THEN 0
          ELSE MAX(0, cooldown_seconds - (strftime('%s', 'now') - strftime('%s', last_sent_at)))
        END AS cooldown_remaining_sec
      FROM accounts
      ORDER BY id ASC
    `);
    return stmt.all();
  }

  /**
   * Returns aggregate pool capacity metrics
   */
  static getPoolMetrics() {
    this.refreshRollingQuotas();
    const stmt = db.prepare(`
      SELECT 
        COUNT(*) AS total_accounts,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_accounts,
        SUM(daily_limit) AS total_daily_capacity,
        SUM(sent_today) AS total_sent_today,
        SUM(MAX(0, daily_limit - sent_today)) AS total_remaining_today
      FROM accounts
    `);
    return stmt.get();
  }
}

module.exports = AccountPool;
