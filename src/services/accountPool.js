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
   * @param {number|null} specificAccountId Optional account ID to target
   * @returns {Object|null} account record or null if all accounts are throttled/exhausted
   */
  static getAvailableAccount(specificAccountId = null) {
    this.refreshRollingQuotas();

    if (specificAccountId) {
      const specificStmt = db.prepare(`
        SELECT * FROM accounts
        WHERE id = ?
          AND is_active = 1
          AND sent_today < daily_limit
          AND (
            cooldown_until IS NULL
            OR strftime('%s', 'now') >= strftime('%s', cooldown_until)
          )
          AND (
            cooldown_seconds = 0
            OR last_sent_at IS NULL
            OR (strftime('%s', 'now') - strftime('%s', last_sent_at)) >= cooldown_seconds
          )
        LIMIT 1
      `);
      return specificStmt.get(specificAccountId) || null;
    }

    const stmt = db.prepare(`
      SELECT * FROM accounts
      WHERE is_active = 1
        AND sent_today < daily_limit
        AND (
          cooldown_until IS NULL
          OR strftime('%s', 'now') >= strftime('%s', cooldown_until)
        )
        AND (
          cooldown_seconds = 0
          OR last_sent_at IS NULL
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
   * Temporarily puts an account into cooldown (e.g. after a 429 or 455 throttle)
   * Decoupled from configured cooldown_seconds: preserves user settings!
   * @param {number} accountId
   * @param {number} cooldownSeconds
   */
  static putOnCooldown(accountId, cooldownSeconds = 120) {
    const stmt = db.prepare(`
      UPDATE accounts
      SET last_sent_at = datetime('now'),
          cooldown_until = datetime('now', '+' || ? || ' seconds')
      WHERE id = ?
    `);
    stmt.run(cooldownSeconds, accountId);
  }

  /**
   * Adds or updates a sender account in the pool.
   * Preserves user-configured daily_limit and cooldown_seconds on conflict!
   * @param {Object} account
   */
  static upsertAccount({ email, displayName, provider = 'GRAPH_API', dailyLimit = 500, cooldownSeconds = 0 }) {
    const stmt = db.prepare(`
      INSERT INTO accounts (email, display_name, provider, daily_limit, cooldown_seconds, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(email) DO UPDATE SET
        display_name = excluded.display_name,
        provider = excluded.provider,
        is_active = 1
    `);
    stmt.run(email.toLowerCase().trim(), displayName, provider, dailyLimit, cooldownSeconds);
  }

  /**
   * Bulk updates daily_limit and optionally cooldown_seconds across all or filtered accounts
   * @param {Object} options
   * @param {number} options.dailyLimit
   * @param {number} [options.cooldownSeconds]
   * @param {string} [options.provider] Optional provider filter ('GRAPH_API', 'AZURE_ACS', 'OCI', or 'ALL')
   * @returns {number} number of affected accounts
   */
  static bulkUpdateLimits({ dailyLimit, cooldownSeconds, provider = 'ALL' }) {
    let sql = 'UPDATE accounts SET daily_limit = ?';
    const params = [parseInt(dailyLimit, 10)];

    if (cooldownSeconds !== undefined && cooldownSeconds !== null) {
      sql += ', cooldown_seconds = ?';
      params.push(parseInt(cooldownSeconds, 10));
    }

    if (provider && provider !== 'ALL') {
      sql += ' WHERE provider = ?';
      params.push(provider);
    }

    const info = db.prepare(sql).run(...params);
    return info.changes;
  }

  /**
   * Updates an existing account's configurable fields by ID
   * @param {number|string} id
   * @param {Object} updates
   */
  static updateAccountById(id, { email, displayName, provider, dailyLimit, cooldownSeconds, isActive } = {}) {
    const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    if (!existing) return null;

    const nextEmail = email !== undefined && email.trim() ? email.toLowerCase().trim() : existing.email;
    const nextDisplayName = displayName !== undefined ? displayName.trim() : existing.display_name;
    const nextProvider = provider !== undefined ? provider : existing.provider;
    const nextDailyLimit = dailyLimit !== undefined ? parseInt(dailyLimit, 10) : existing.daily_limit;
    const nextCooldown = cooldownSeconds !== undefined ? parseInt(cooldownSeconds, 10) : existing.cooldown_seconds;
    const nextIsActive = isActive !== undefined ? (isActive ? 1 : 0) : existing.is_active;

    db.prepare(`
      UPDATE accounts
      SET email = ?,
          display_name = ?,
          provider = ?,
          daily_limit = ?,
          cooldown_seconds = ?,
          is_active = ?
      WHERE id = ?
    `).run(nextEmail, nextDisplayName, nextProvider, nextDailyLimit, nextCooldown, nextIsActive, id);

    return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  }

  /**
   * Returns list of all accounts with live telemetry & cognitive fields
   */
  static getAllAccounts() {
    this.refreshRollingQuotas();
    const stmt = db.prepare(`
      SELECT 
        id, email, display_name, provider, daily_limit, sent_today,
        last_sent_at, cooldown_seconds, cooldown_until, is_active,
        status, health_score, sending_speed, custom_interval_ms,
        failure_count, bounce_count, complaint_count,
        MAX(0, daily_limit - sent_today) AS remaining_today,
        CASE 
          WHEN cooldown_until IS NOT NULL AND strftime('%s', cooldown_until) > strftime('%s', 'now')
            THEN MAX(0, strftime('%s', cooldown_until) - strftime('%s', 'now'))
          WHEN last_sent_at IS NULL THEN 0
          ELSE MAX(0, cooldown_seconds - (strftime('%s', 'now') - strftime('%s', last_sent_at)))
        END AS cooldown_remaining_sec
      FROM accounts
      ORDER BY id ASC
    `);
    const list = stmt.all();

    return list.map(acc => {
      const remainingSec = acc.cooldown_remaining_sec || 0;
      let effectiveStatus = acc.status || 'ACTIVE';
      let humanStatus = 'Ready';
      let statusColor = 'emerald';

      if (acc.is_active === 0 || effectiveStatus === 'DISABLED') {
        humanStatus = 'Disabled';
        statusColor = 'muted';
      } else if (effectiveStatus === 'AUTH_ERROR') {
        humanStatus = 'Authentication Problem';
        statusColor = 'rose';
      } else if (remainingSec > 0) {
        humanStatus = 'Temporarily paused';
        statusColor = 'amber';
      } else if (acc.remaining_today <= 0) {
        humanStatus = 'Daily Limit Reached';
        statusColor = 'amber';
      } else if (effectiveStatus === 'DEGRADED') {
        humanStatus = 'Reduced Sending';
        statusColor = 'amber';
      }

      // Calculate dynamic cognitive health score (0-100)
      let calculatedHealth = 100;
      const recentErrors = acc.failure_count || 0;
      const recentBounces = acc.bounce_count || 0;
      calculatedHealth -= Math.min(40, recentErrors * 10);
      calculatedHealth -= Math.min(40, recentBounces * 15);
      if (acc.remaining_today <= 0) calculatedHealth = Math.min(calculatedHealth, 85);
      if (effectiveStatus === 'AUTH_ERROR') calculatedHealth = 10;
      calculatedHealth = Math.max(10, Math.min(100, calculatedHealth));

      return {
        ...acc,
        computed_health_score: calculatedHealth,
        human_status: humanStatus,
        status_color: statusColor,
        is_temporarily_paused: remainingSec > 0
      };
    });
  }

  /**
   * Diagnostic engine: Determines plain-language reason why a campaign is waiting/paused
   * @param {number} campaignId
   * @returns {Object} { reason, nextAvailableAccount, secondsRemaining }
   */
  static getCampaignWaitReason(campaignId) {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (!campaign) return { reason: 'Campaign not found.', canResume: false };

    const waitingItems = db.prepare(`
      SELECT COUNT(*) AS count FROM queue 
      WHERE campaign_id = ? AND status IN ('queued', 'sending')
    `).get(campaignId).count;

    if (waitingItems === 0) {
      return { reason: 'No items waiting in this campaign.', canResume: false };
    }

    const accounts = this.getAllAccounts();
    const activeAccounts = accounts.filter(a => a.is_active === 1);

    if (activeAccounts.length === 0) {
      return {
        reason: 'All sending accounts are currently disabled or inactive.',
        nextAvailableAccount: null,
        secondsRemaining: null,
        canResume: false
      };
    }

    // If campaign is pinned to a specific account
    const pinnedId = campaign.pinned_account_id || campaign.sender_account_id;
    if (pinnedId) {
      const targetAcc = activeAccounts.find(a => a.id === pinnedId);
      if (!targetAcc) {
        return {
          reason: 'The assigned sending account has been removed or disabled.',
          nextAvailableAccount: null,
          secondsRemaining: null,
          canResume: false
        };
      }

      if (targetAcc.remaining_today <= 0) {
        if (campaign.fallback_allowed === 1) {
          // Fallback allowed: check other accounts
          const fallbackCandidates = activeAccounts.filter(a => a.id !== pinnedId && a.remaining_today > 0);
          if (fallbackCandidates.length > 0) {
            return {
              reason: `Primary account "${targetAcc.email}" reached its daily sending limit. Automatically rotating to fallback account.`,
              nextAvailableAccount: fallbackCandidates[0].display_name || fallbackCandidates[0].email,
              secondsRemaining: 0,
              canResume: true
            };
          }
        }
        return {
          reason: `Assigned account "${targetAcc.email}" reached its daily sending limit (${targetAcc.daily_limit.toLocaleString()} emails). Waiting for window reset.`,
          nextAvailableAccount: targetAcc.display_name || targetAcc.email,
          secondsRemaining: null,
          canResume: false
        };
      }

      if (targetAcc.cooldown_remaining_sec > 0) {
        return {
          reason: `Assigned account "${targetAcc.display_name || targetAcc.email}" is temporarily resting to protect sender reputation.`,
          nextAvailableAccount: targetAcc.display_name || targetAcc.email,
          secondsRemaining: targetAcc.cooldown_remaining_sec,
          canResume: true
        };
      }
    }

    // Smart Send Mode: check whole pool
    const accountsWithCapacity = activeAccounts.filter(a => a.remaining_today > 0);
    if (accountsWithCapacity.length === 0) {
      return {
        reason: 'All available sending accounts have reached their daily sending limits. Sending will resume as quota refreshes.',
        nextAvailableAccount: null,
        secondsRemaining: null,
        canResume: false
      };
    }

    // All capable accounts in cooldown
    const cooldownTimes = accountsWithCapacity
      .filter(a => a.cooldown_remaining_sec > 0)
      .map(a => ({ name: a.display_name || a.email, seconds: a.cooldown_remaining_sec }))
      .sort((a, b) => a.seconds - b.seconds);

    if (cooldownTimes.length > 0) {
      const nextOne = cooldownTimes[0];
      return {
        reason: 'Sending accounts are temporarily pacing dispatch to maintain inbox reputation.',
        nextAvailableAccount: nextOne.name,
        secondsRemaining: nextOne.seconds,
        canResume: true
      };
    }

    return {
      reason: 'Campaign is ready and worker is processing queue.',
      nextAvailableAccount: null,
      secondsRemaining: 0,
      canResume: true
    };
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
