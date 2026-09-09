/**
 * Continuous Background Queue Worker Engine
 * Orchestrates multi-account leased dispatch, anti-spam pacing, and crash recovery
 */

const db = require('../db');
const config = require('../config/env');
const AccountPool = require('./accountPool');
const { sendViaGraph } = require('./graphMailer');
const { sendViaACS } = require('./acsMailer');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class QueueWorker {
  constructor() {
    this.isRunning = false;
    this.isPaused = false;
    this.currentTask = null;
    this.lastDispatchedAt = null;
    this.workerLoopPromise = null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isPaused = false;
    console.log('[QueueWorker] 🚀 Background queue worker engine started.');
    this.workerLoopPromise = this.loop().catch((err) => {
      console.error('[QueueWorker] Fatal error in worker loop:', err);
      this.isRunning = false;
    });
  }

  pause() {
    this.isPaused = true;
    console.log('[QueueWorker] ⏸️ Queue worker paused by user.');
  }

  resume() {
    this.isPaused = false;
    console.log('[QueueWorker] ▶️ Queue worker resumed.');
  }

  async loop() {
    while (this.isRunning) {
      if (this.isPaused) {
        await sleep(2000);
        continue;
      }

      try {
        // 1. Fetch next queued item
        const item = db.prepare(`
          SELECT q.*, c.name AS campaign_name 
          FROM queue q
          LEFT JOIN campaigns c ON q.campaign_id = c.id
          WHERE q.status = 'queued'
          ORDER BY q.id ASC
          LIMIT 1
        `).get();

        if (!item) {
          // No work to do, sleep 3s
          await sleep(3000);
          continue;
        }

        // 2. Request an available account from the multi-account pool
        const account = AccountPool.getAvailableAccount();

        if (!account) {
          // All accounts are either in cooldown or hit daily limits
          // Sleep 5s and wait for cooldown window
          await sleep(5000);
          continue;
        }

        // 3. Mark as sending atomically
        db.prepare(`
          UPDATE queue 
          SET status = 'sending',
              account_id = ?,
              attempts = attempts + 1
          WHERE id = ?
        `).run(account.id, item.id);

        this.currentTask = {
          queueId: item.id,
          to: item.email,
          account: account.email,
          startedAt: Date.now()
        };

        // 4. Dispatch through appropriate provider
        try {
          console.log(`[QueueWorker] ✉️ Sending to "${item.email}" via [${account.provider}] ${account.email}...`);

          if (account.provider === 'AZURE_ACS') {
            await sendViaACS({
              fromEmail: account.email,
              toEmail: item.email,
              subject: item.subject,
              htmlBody: item.rendered_html
            });
          } else {
            // Default to Graph API
            await sendViaGraph({
              fromEmail: account.email,
              toEmail: item.email,
              subject: item.subject,
              htmlBody: item.rendered_html
            });
          }

          // 5. Record Success
          db.prepare(`
            UPDATE queue
            SET status = 'sent',
                sent_at = datetime('now'),
                last_error = ''
            WHERE id = ?
          `).run(item.id);

          AccountPool.recordSendSuccess(account.id);

          // Update campaign counts
          db.prepare(`
            UPDATE campaigns
            SET sent_count = sent_count + 1
            WHERE id = ?
          `).run(item.campaign_id);

          // Log event
          db.prepare(`
            INSERT INTO logs (campaign_id, account_id, level, message)
            VALUES (?, ?, 'INFO', ?)
          `).run(item.campaign_id, account.id, `Successfully sent to "${item.email}" via ${account.email}`);

          console.log(`[QueueWorker] ✅ Delivered to "${item.email}" (Account: ${account.email}, Sent today: ${account.sent_today + 1}/${account.daily_limit})`);

        } catch (dispatchErr) {
          console.error(`[QueueWorker] ❌ Failed to dispatch to "${item.email}":`, dispatchErr.message);

          if (dispatchErr.isThrottled || dispatchErr.statusCode === 429) {
            // Microsoft Graph Rate Limit reached (30 msg/min cap)
            const waitSeconds = dispatchErr.retryAfter || 120;
            console.warn(`[QueueWorker] ⚠️ Account ${account.email} throttled by Microsoft Graph. Applying ${waitSeconds}s cooldown and rotating accounts.`);
            AccountPool.putOnCooldown(account.id, waitSeconds);

            // Requeue item immediately so another account in the pool can take it
            db.prepare(`
              UPDATE queue
              SET status = 'queued',
                  account_id = NULL,
                  last_error = ?
              WHERE id = ?
            `).run(dispatchErr.message, item.id);

            db.prepare(`
              INSERT INTO logs (campaign_id, account_id, level, message)
              VALUES (?, ?, 'WARN', ?)
            `).run(item.campaign_id, account.id, `Account throttled (429). Cooldown ${waitSeconds}s applied. Requeued email.`);

          } else {
            const maxAttempts = 3;
            const isPermanent = item.attempts + 1 >= maxAttempts || dispatchErr.statusCode === 404;

            db.prepare(`
              UPDATE queue
              SET status = ?,
                  last_error = ?
              WHERE id = ?
            `).run(isPermanent ? 'failed' : 'queued', dispatchErr.message, item.id);

            if (isPermanent) {
              db.prepare(`
                UPDATE campaigns
                SET failed_count = failed_count + 1
                WHERE id = ?
              `).run(item.campaign_id);
            }

            db.prepare(`
              INSERT INTO logs (campaign_id, account_id, level, message)
              VALUES (?, ?, 'ERROR', ?)
            `).run(item.campaign_id, account.id, `Failed sending to "${item.email}": ${dispatchErr.message}`);
          }
        }

        this.currentTask = null;
        this.lastDispatchedAt = Date.now();

        // 6. Global Pacing sleep (2.5s = 24/min max per global loop)
        await sleep(config.globalSendIntervalMs);

      } catch (loopErr) {
        console.error('[QueueWorker] Unexpected error in worker tick:', loopErr);
        await sleep(4000);
      }
    }
  }

  getStatus() {
    const queueCounts = db.prepare(`
      SELECT 
        COUNT(CASE WHEN status = 'queued' THEN 1 END) AS queued,
        COUNT(CASE WHEN status = 'sending' THEN 1 END) AS sending,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) AS sent,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) AS failed,
        COUNT(*) AS total
      FROM queue
    `).get();

    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      currentTask: this.currentTask,
      lastDispatchedAt: this.lastDispatchedAt,
      queue: queueCounts
    };
  }
}

// Singleton instance
const queueWorker = new QueueWorker();

module.exports = queueWorker;
