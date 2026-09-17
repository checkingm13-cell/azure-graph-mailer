/**
 * Continuous Background Queue Worker Engine
 * Orchestrates multi-account leased dispatch, anti-spam pacing, and crash recovery
 */

const db = require('../db');
const config = require('../config/env');
const AccountPool = require('./accountPool');
const { sendViaGraph } = require('./graphMailer');
const { sendViaACS } = require('./acsMailer');
const { sendViaOCI } = require('./ociMailer');
const { renderTemplate } = require('./templateEngine');
const batchChainManager = require('./batchChainManager');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getSendIntervalMs() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'send_interval_ms'").get();
    if (row && row.value) {
      const parsed = parseInt(row.value, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch (e) {}
  return config.globalSendIntervalMs;
}

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

    // Crash Recovery Hook: Recover any stranded in-flight records from server restarts
    try {
      const recovered = db.prepare(`
        UPDATE queue 
        SET status = 'queued', account_id = NULL 
        WHERE status = 'sending'
      `).run();
      if (recovered.changes > 0) {
        console.log(`[QueueWorker] 🔄 Crash Recovery: Re-queued ${recovered.changes} stranded 'sending' email(s).`);
      }
    } catch (err) {
      console.error('[QueueWorker] Error recovering stranded sending items:', err);
    }

    console.log('[QueueWorker] 🚀 Background queue worker engine started.');
    this.workerLoopPromise = this.loop().catch((err) => {
      console.error('[QueueWorker] Fatal error in worker loop:', err);
      this.isRunning = false;
    });

    // Auto-Batch Chaining: Periodic check for completed batches
    setInterval(() => {
      batchChainManager.monitorBatchCompletion().catch(console.error);
    }, 30000);
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
    // Dynamic concurrency limit (default: 5 concurrent dispatch slots)
    const getConcurrencyLimit = () => {
      try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'worker_concurrency'").get();
        if (row && row.value) {
          const parsed = parseInt(row.value, 10);
          if (!isNaN(parsed) && parsed > 0) return Math.min(parsed, 20);
        }
      } catch (e) {}
      return 5;
    };

    while (this.isRunning) {
      if (this.isPaused) {
        await sleep(2000);
        continue;
      }

      try {
        const concurrency = getConcurrencyLimit();
        AccountPool.refreshRollingQuotas();

        // 1. Fetch available accounts (not throttled, not cooled down, quota remaining)
        const availableAccounts = db.prepare(`
          SELECT * FROM accounts
          WHERE is_active = 1
            AND sent_today < daily_limit
            AND (cooldown_until IS NULL OR strftime('%s', 'now') >= strftime('%s', cooldown_until))
            AND (
              cooldown_seconds = 0
              OR last_sent_at IS NULL
              OR (strftime('%s', 'now') - strftime('%s', last_sent_at)) >= cooldown_seconds
            )
          ORDER BY 
            CASE WHEN last_sent_at IS NULL THEN 0 ELSE 1 END ASC,
            last_sent_at ASC,
            sent_today ASC,
            id ASC
          LIMIT ?
        `).all(concurrency);

        if (!availableAccounts || availableAccounts.length === 0) {
          // All accounts are either throttled or reached daily limits
          await sleep(3000);
          continue;
        }

        // 2. Fetch eligible queue items up to available account count
        const queueItems = db.prepare(`
          SELECT q.*, c.name AS campaign_name, c.status AS campaign_status,
                 c.mode AS campaign_mode,
                 COALESCE(c.pinned_account_id, c.sender_account_id) AS campaign_pinned_account_id,
                 c.fallback_allowed AS campaign_fallback_allowed,
                 c.custom_interval_ms AS campaign_custom_interval_ms
          FROM queue q
          JOIN campaigns c ON q.campaign_id = c.id
          WHERE q.status = 'queued'
            AND (q.scheduled_at IS NULL OR q.scheduled_at <= datetime('now'))
            AND c.status IN ('SCHEDULED', 'QUEUED', 'RUNNING')
          ORDER BY q.scheduled_at ASC, q.id ASC
          LIMIT ?
        `).all(availableAccounts.length);

        if (!queueItems || queueItems.length === 0) {
          // No items ready to send; check if any campaigns should be marked completed
          await sleep(2000);
          continue;
        }

        // 3. Mark campaign as RUNNING for any active batch
        const campaignIds = [...new Set(queueItems.map(it => it.campaign_id))];
        for (const campId of campaignIds) {
          db.prepare(`
            UPDATE campaigns
            SET status = 'RUNNING',
                started_at = COALESCE(started_at, datetime('now'))
            WHERE id = ? AND status IN ('SCHEDULED', 'QUEUED')
          `).run(campId);
        }

        // 4. Parallel Dispatch across leased accounts
        const assignedAccountIds = new Set();

        const dispatchPromises = queueItems.map(async (item, idx) => {
          // Match account respecting campaign policy
          let account = null;

          if (item.campaign_mode === 'CONTROLLED' && item.campaign_pinned_account_id) {
            account = availableAccounts.find(a => a.id === item.campaign_pinned_account_id && !assignedAccountIds.has(a.id));
            if (!account && item.campaign_fallback_allowed === 1) {
              account = availableAccounts.find(a => !assignedAccountIds.has(a.id));
            }
          } else {
            account = availableAccounts.find(a => !assignedAccountIds.has(a.id)) || availableAccounts[idx % availableAccounts.length];
          }

          if (!account) return;
          assignedAccountIds.add(account.id);

          // Atomically lock record into 'sending'
          db.prepare(`
            UPDATE queue 
            SET status = 'sending',
                account_id = ?,
                attempts = attempts + 1
            WHERE id = ?
          `).run(account.id, item.id);

          // Detailed Delivery Audit Log: Record/Update dispatch lifecycle
          try {
            db.prepare(`
              INSERT INTO delivery_logs (
                campaign_id, queue_id, account_id, recipient_email, recipient_name,
                sender_email, sender_provider, subject, template_name, status,
                queued_at, started_at, created_at, attempts
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sending', datetime('now'), datetime('now'), datetime('now'), ?)
            `).run(
              item.campaign_id,
              item.id,
              account.id,
              item.email,
              item.name || '',
              account.email,
              account.provider,
              item.subject || '',
              item.template_name || 'Standard',
              item.attempts + 1
            );
          } catch (_) {}

          // Advance last_sent_at immediately so round-robin cycles cleanly
          db.prepare(`
            UPDATE accounts
            SET last_sent_at = datetime('now')
            WHERE id = ?
          `).run(account.id);

          this.currentTask = {
            queueId: item.id,
            campaignId: item.campaign_id,
            campaignName: item.campaign_name,
            to: item.email,
            account: account.email,
            startedAt: Date.now()
          };

          try {
            console.log(`[QueueWorker] ✉️ [Parallel] Sending to "${item.email}" via [${account.provider}] ${account.email}...`);

            const dynamicSubject = renderTemplate(item.subject, {
              sender_email: account.email,
              email: item.email,
              name: item.name
            });
            const dynamicHtml = renderTemplate(item.rendered_html, {
              sender_email: account.email,
              email: item.email,
              name: item.name
            });

            if (account.provider === 'AZURE_ACS') {
              await sendViaACS({
                fromEmail: account.email,
                toEmail: item.email,
                subject: dynamicSubject,
                htmlBody: dynamicHtml
              });
            } else if (account.provider === 'OCI') {
              await sendViaOCI({
                fromEmail: account.email,
                toEmail: item.email,
                subject: dynamicSubject,
                htmlBody: dynamicHtml
              });
            } else {
              await sendViaGraph({
                fromEmail: account.email,
                toEmail: item.email,
                subject: dynamicSubject,
                htmlBody: dynamicHtml
              });
            }

            // Record Success
            db.prepare(`
              UPDATE queue
              SET status = 'sent',
                  sent_at = datetime('now'),
                  accepted_at = datetime('now'),
                  provider_message_id = COALESCE(provider_message_id, 'msg_' || hex(randomblob(8))),
                  last_error = ''
              WHERE id = ?
            `).run(item.id);

            // Detailed Delivery Audit Log: Record Success
            try {
              db.prepare(`
                UPDATE delivery_logs 
                SET status = 'sent', 
                    completed_at = datetime('now'),
                    provider_message_id = COALESCE(provider_message_id, 'msg_' || hex(randomblob(8))),
                    error_message = ''
                WHERE queue_id = ?
              `).run(item.id);
            } catch (_) {}

            AccountPool.recordSendSuccess(account.id);

            db.prepare(`
              UPDATE campaigns
              SET sent_count = sent_count + 1
              WHERE id = ?
            `).run(item.campaign_id);

            // Check if campaign is now completed
            const remaining = db.prepare(`
              SELECT COUNT(*) AS count 
              FROM queue 
              WHERE campaign_id = ? AND status IN ('queued', 'sending')
            `).get(item.campaign_id).count;

            if (remaining === 0) {
              db.prepare(`
                UPDATE campaigns
                SET status = 'COMPLETED',
                    completed_at = datetime('now')
                WHERE id = ?
              `).run(item.campaign_id);
              console.log(`[QueueWorker] 🏁 Campaign "${item.campaign_name}" (ID: ${item.campaign_id}) has COMPLETED!`);

              // Auto-Batch Chaining: Immediately trigger next sequential batch
              const match = (item.campaign_name || '').match(/Batch_(\d+)/);
              if (match) {
                const batchNumber = parseInt(match[1], 10);
                batchChainManager.checkAndTriggerNextBatch(item.campaign_id, batchNumber).catch(console.error);
              }
            }

            db.prepare(`
              INSERT INTO logs (campaign_id, account_id, level, message)
              VALUES (?, ?, 'INFO', ?)
            `).run(item.campaign_id, account.id, `Successfully sent to "${item.email}" via ${account.email}`);

            console.log(`[QueueWorker] ✅ Delivered to "${item.email}" (Account: ${account.email}, Sent today: ${account.sent_today + 1}/${account.daily_limit})`);

          } catch (dispatchErr) {
            console.error(`[QueueWorker] ❌ Failed to dispatch to "${item.email}":`, dispatchErr.message);

            const isOciThrottled = dispatchErr.message && (
              dispatchErr.message.includes('455') || 
              dispatchErr.message.toLowerCase().includes('per minute reached')
            );

            if (isOciThrottled) {
              console.warn(`[QueueWorker] ⚠️ OCI 455 Rate Limit on ${account.email}. Applying 60s cooldown and requeuing "${item.email}" for immediate pool rotation...`);
              AccountPool.putOnCooldown(account.id, 60);

              // Requeue immediately with NO backoff so another healthy account picks it up right away
              db.prepare(`
                UPDATE queue
                SET status = 'queued',
                    account_id = NULL,
                    last_error = 'OCI 455 rate limit - requeued for rotation'
                WHERE id = ?
              `).run(item.id);

              db.prepare(`
                INSERT INTO logs (campaign_id, account_id, level, message)
                VALUES (?, ?, 'WARN', ?)
              `).run(item.campaign_id, account.id, `OCI 455 Throttle: Account cooled down 60s. Item rotated.`);

            } else if (dispatchErr.isThrottled || dispatchErr.statusCode === 429) {
              const waitSeconds = dispatchErr.retryAfter || 120;
              console.warn(`[QueueWorker] ⚠️ Account ${account.email} throttled (429). Applying ${waitSeconds}s cooldown and rotating accounts.`);
              AccountPool.putOnCooldown(account.id, waitSeconds);

              // Requeue immediately without delay so sibling account takes it
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
              `).run(item.campaign_id, account.id, `Account throttled (429). Cooldown ${waitSeconds}s applied. Item rotated.`);

            } else {
              const maxAttempts = 3;
              const isPermanent = item.attempts + 1 >= maxAttempts || dispatchErr.statusCode === 404;

              // Tail-End 49/50 Fix: If other accounts exist, don't stall for 300s. Use minimal backoff (3s, 10s)
              const backoffSec = [3, 10, 30][Math.min(item.attempts || 0, 2)];
              const nextScheduledAt = isPermanent ? null : new Date(Date.now() + backoffSec * 1000).toISOString().replace('T', ' ').slice(0, 19);

              db.prepare(`
                UPDATE queue
                SET status = ?,
                    scheduled_at = COALESCE(?, scheduled_at),
                    account_id = NULL,
                    last_error = ?
                WHERE id = ?
              `).run(isPermanent ? 'failed' : 'queued', nextScheduledAt, dispatchErr.message, item.id);

              // Detailed Delivery Audit Log: Record Failure/Requeue
              try {
                db.prepare(`
                  UPDATE delivery_logs 
                  SET status = ?, 
                      completed_at = datetime('now'),
                      error_message = ?,
                      attempts = ?
                  WHERE queue_id = ?
                `).run(isPermanent ? 'failed' : 'queued', dispatchErr.message || 'Unknown error', item.attempts + 1, item.id);
              } catch (_) {}

              if (isPermanent) {
                db.prepare(`
                  UPDATE campaigns
                  SET failed_count = failed_count + 1
                  WHERE id = ?
                `).run(item.campaign_id);

                // Check if campaign is now completed
                const remaining = db.prepare(`
                  SELECT COUNT(*) AS count 
                  FROM queue 
                  WHERE campaign_id = ? AND status IN ('queued', 'sending')
                `).get(item.campaign_id).count;

                if (remaining === 0) {
                  db.prepare(`
                    UPDATE campaigns
                    SET status = 'COMPLETED',
                        completed_at = datetime('now')
                    WHERE id = ?
                  `).run(item.campaign_id);
                  console.log(`[QueueWorker] 🏁 Campaign "${item.campaign_name}" (ID: ${item.campaign_id}) has COMPLETED!`);

                  // Auto-Batch Chaining: Immediately trigger next sequential batch
                  const match = (item.campaign_name || '').match(/Batch_(\d+)/);
                  if (match) {
                    const batchNumber = parseInt(match[1], 10);
                    batchChainManager.checkAndTriggerNextBatch(item.campaign_id, batchNumber).catch(console.error);
                  }
                }
              }

              db.prepare(`
                INSERT INTO logs (campaign_id, account_id, level, message)
                VALUES (?, ?, 'ERROR', ?)
              `).run(item.campaign_id, account.id, `Failed sending to "${item.email}": ${dispatchErr.message}`);
            }
          }
        });

        // 5. Wait for all parallel dispatch tasks in this slot
        await Promise.allSettled(dispatchPromises);

        this.currentTask = null;
        this.lastDispatchedAt = Date.now();

        // 6. Balanced batch pacing delay (default ~1000-2000ms between parallel batches)
        const pacingMs = Math.max(500, Math.min(getSendIntervalMs(), 2000));
        await sleep(pacingMs);

      } catch (loopErr) {
        console.error('[QueueWorker] Unexpected error in worker tick:', loopErr);
        await sleep(3000);
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

    // Fetch primary active campaign
    const activeCamp = db.prepare(`
      SELECT c.*, t.name AS template_name
      FROM campaigns c
      LEFT JOIN templates t ON c.template_id = t.id
      WHERE c.status = 'RUNNING'
      LIMIT 1
    `).get();

    let activeCampaign = null;
    if (activeCamp) {
      const processed = (activeCamp.sent_count || 0) + (activeCamp.failed_count || 0);
      const remaining = Math.max(0, (activeCamp.total_count || 0) - processed);
      const progressPct = activeCamp.total_count > 0 
        ? Math.min(100, Math.round((processed / activeCamp.total_count) * 100)) 
        : 0;
      const etaSeconds = Math.round(remaining * (getSendIntervalMs() / 1000));

      activeCampaign = {
        id: activeCamp.id,
        name: activeCamp.name,
        templateName: activeCamp.template_name || 'Standard Template',
        status: activeCamp.status,
        totalCount: activeCamp.total_count,
        sentCount: activeCamp.sent_count,
        failedCount: activeCamp.failed_count,
        remaining,
        progressPct,
        etaSeconds,
        scheduledAt: activeCamp.scheduled_at,
        startedAt: activeCamp.started_at,
        activeSender: this.currentTask ? this.currentTask.account : null,
        currentRecipient: this.currentTask ? this.currentTask.to : null
      };
    }

    // Fetch upcoming scheduled/queued campaigns (excluding the one active)
    const activeId = activeCampaign ? activeCampaign.id : -1;
    const upcomingCampaigns = db.prepare(`
      SELECT c.*, t.name AS template_name
      FROM campaigns c
      LEFT JOIN templates t ON c.template_id = t.id
      WHERE c.status IN ('SCHEDULED', 'QUEUED') AND c.id != ?
      ORDER BY c.scheduled_at ASC, c.id ASC
      LIMIT 10
    `).all(activeId).map(c => ({
      id: c.id,
      name: c.name,
      templateName: c.template_name || 'Standard Template',
      status: c.status,
      totalCount: c.total_count,
      scheduledAt: c.scheduled_at
    }));

    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      sendIntervalMs: getSendIntervalMs(),
      currentTask: this.currentTask,
      lastDispatchedAt: this.lastDispatchedAt,
      queue: queueCounts,
      activeCampaign,
      upcomingCampaigns
    };
  }
}

// Singleton instance
const queueWorker = new QueueWorker();

module.exports = queueWorker;
