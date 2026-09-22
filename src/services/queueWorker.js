/**
 * Continuous Background Queue Worker Engine
 * Orchestrates multi-account leased dispatch, anti-spam pacing, and crash recovery
 */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config/env');
const AccountPool = require('./accountPool');
const { sendViaGraph } = require('./graphMailer');
const { sendViaACS } = require('./acsMailer');
const { sendViaOCI } = require('./ociMailer');
const { sendViaMailgun } = require('./mailgunMailer');
const { renderTemplate } = require('./templateEngine');
const batchChainManager = require('./batchChainManager');
const { toISTString, IST_SQL_NOW, formatISTClock, formatDuration, parseIST } = require('../utils/time');

const VISUAL_CID_ATTACHMENTS = {
  'author_publishing_guide': {
    filename: 'author-publishing-guide.jpg',
    path: path.resolve(__dirname, '../../public/author-publishing-guide-4-steps.jpg'),
    cid: 'author_publishing_guide'
  },
  'ijsr_email_banner': {
    filename: 'IJSR-email.jpg',
    path: path.resolve(__dirname, '../../public/IJSR-email.jpg'),
    cid: 'ijsr_email_banner'
  },
  'paripex_email_banner': {
    filename: 'paripex-email.jpg',
    path: path.resolve(__dirname, '../../public/paripex-email.jpg'),
    cid: 'paripex_email_banner'
  },
  'gjra_email_banner': {
    filename: 'gjra-email.jpg',
    path: path.resolve(__dirname, '../../public/gjra-email.jpg'),
    cid: 'gjra_email_banner'
  }
};

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

const withTimeout = (promise, ms, desc) => {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${desc || 'Operation'} timed out after ${ms}ms`)), ms)
    )
  ]);
};

class QueueWorker {
  constructor() {
    this.isRunning = false;
    this.isPaused = false;
    this.currentTask = null;
    this.lastDispatchedAt = null;
    this.lastWatchdogRun = 0;
    this.priorityCampaignIds = new Set();
    this.sleepResolver = null;
  }

  wake() {
    if (this.sleepResolver) {
      const resolve = this.sleepResolver;
      this.sleepResolver = null;
      resolve();
    }
  }

  interruptibleSleep(ms) {
    return new Promise((resolve) => {
      let timer = null;
      const onWake = () => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      this.sleepResolver = onWake;
      timer = setTimeout(() => {
        if (this.sleepResolver === onWake) {
          this.sleepResolver = null;
        }
        resolve();
      }, ms);
    });
  }

  triggerInstantSend(campaignIds = []) {
    if (Array.isArray(campaignIds)) {
      for (const id of campaignIds) {
        this.priorityCampaignIds.add(parseInt(id, 10));
      }
    } else if (campaignIds) {
      this.priorityCampaignIds.add(parseInt(campaignIds, 10));
    }
    console.log(`[QueueWorker] ⚡ Instant send requested for campaigns: [${Array.from(this.priorityCampaignIds).join(', ')}]. Waking worker immediately!`);
    this.isPaused = false;
    this.wake();
  }

  checkWatchdog() {
    const now = Date.now();
    if (now - this.lastWatchdogRun < 30000) return;
    this.lastWatchdogRun = now;
    try {
      // Auto-recover any item stranded in 'sending' for > 90 seconds
      const res = db.prepare(`
        UPDATE queue 
        SET status = 'queued', account_id = NULL, scheduled_at = datetime('now', '+330 minutes')
        WHERE status = 'sending'
      `).run();
      if (res.changes > 0) {
        console.log(`[QueueWorker] 🔄 Watchdog: Auto-recovered ${res.changes} item(s) stranded in sending.`);
      }
    } catch (_) {}
  }

  checkCampaignCompletion(campaignId, campaignName) {
    try {
      const remaining = db.prepare(`
        SELECT COUNT(*) AS count 
        FROM queue 
        WHERE campaign_id = ? AND status IN ('queued', 'sending')
      `).get(campaignId).count;

      if (remaining === 0) {
        db.prepare(`
          UPDATE campaigns
          SET status = 'COMPLETED',
              completed_at = datetime('now', '+330 minutes')
          WHERE id = ? AND status != 'COMPLETED'
        `).run(campaignId);
        console.log(`[QueueWorker] 🏁 Campaign "${campaignName}" (ID: ${campaignId}) has COMPLETED!`);
        this.priorityCampaignIds.delete(campaignId);

        // Auto-Batch Chaining: Immediately trigger next sequential batch
        const match = (campaignName || '').match(/Batch_(\d+)/);
        if (match) {
          const batchNumber = parseInt(match[1], 10);
          batchChainManager.checkAndTriggerNextBatch(campaignId, batchNumber).catch(console.error);
        }
      }
    } catch (e) {
      console.error('[QueueWorker] Error checking campaign completion:', e);
    }
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

    // Auto-Batch Chaining: Immediate check on boot + 15s interval for completed batches
    batchChainManager.monitorBatchCompletion().catch(console.error);
    setInterval(() => {
      batchChainManager.monitorBatchCompletion().catch(console.error);
    }, 15000);
  }

  pause() {
    this.isPaused = true;
    console.log('[QueueWorker] ⏸️ Queue worker paused by user.');
  }

  resume() {
    this.isPaused = false;
    console.log('[QueueWorker] ▶️ Queue worker resumed.');
    this.wake();
  }

  async loop() {
    // Dynamic concurrency limit (default: 10 concurrent dispatch slots)
    const getConcurrencyLimit = () => {
      try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'worker_concurrency'").get();
        if (row && row.value) {
          const parsed = parseInt(row.value, 10);
          if (!isNaN(parsed) && parsed > 0) return Math.min(parsed, 20);
        }
      } catch (e) {}
      return 10;
    };

    while (this.isRunning) {
      if (this.isPaused) {
        await this.interruptibleSleep(2000);
        continue;
      }

      try {
        this.checkWatchdog();
        const concurrency = getConcurrencyLimit();
        AccountPool.refreshRollingQuotas();

        // 0. Auto-promote any SCHEDULED or QUEUED batch whose scheduled_at time has arrived
        db.prepare(`
          UPDATE campaigns
          SET status = 'RUNNING',
              started_at = COALESCE(started_at, datetime('now', '+330 minutes'))
          WHERE status IN ('SCHEDULED', 'QUEUED')
            AND scheduled_at IS NOT NULL
            AND scheduled_at <= datetime('now', '+330 minutes')
        `).run();

        // 1. Fetch available accounts (not throttled, not cooled down, quota remaining)
        const availableAccounts = db.prepare(`
          SELECT * FROM accounts
          WHERE is_active = 1
            AND sent_today < daily_limit
            AND (cooldown_until IS NULL OR strftime('%s', 'now', '+330 minutes') >= strftime('%s', cooldown_until))
            AND (
              cooldown_seconds = 0
              OR last_sent_at IS NULL
              OR (strftime('%s', 'now', '+330 minutes') - strftime('%s', last_sent_at)) >= cooldown_seconds
            )
          ORDER BY 
            CASE WHEN last_sent_at IS NULL THEN 0 ELSE 1 END ASC,
            last_sent_at ASC,
            sent_today ASC,
            id ASC
        `).all();

        if (!availableAccounts || availableAccounts.length === 0) {
          // All accounts are either throttled or reached daily limits
          await this.interruptibleSleep(2000);
          continue;
        }

        // 2. Fetch eligible queue items up to available account count with round-robin fair balance
        const priorityIds = Array.from(this.priorityCampaignIds || []);
        let priorityOrderClause = '';
        if (priorityIds.length > 0) {
          const idList = priorityIds.join(',');
          priorityOrderClause = `CASE WHEN campaign_id IN (${idList}) THEN 0 WHEN campaign_status = 'RUNNING' THEN 1 ELSE 2 END ASC,`;
        } else {
          priorityOrderClause = `CASE WHEN campaign_status = 'RUNNING' THEN 0 ELSE 1 END ASC,`;
        }

        const maxDispatchCount = Math.min(availableAccounts.length, concurrency);

        // Fair Round-Robin: Interleaves rows across active campaigns so no single campaign monopolizes dispatch slots
        const queueItems = db.prepare(`
          WITH RankedQueue AS (
            SELECT q.*, c.name AS campaign_name, c.status AS campaign_status,
                   c.mode AS campaign_mode,
                   COALESCE(c.pinned_account_id, c.sender_account_id) AS campaign_pinned_account_id,
                   c.fallback_allowed AS campaign_fallback_allowed,
                   c.custom_interval_ms AS campaign_custom_interval_ms,
                   ROW_NUMBER() OVER (
                     PARTITION BY q.campaign_id 
                     ORDER BY 
                       CASE WHEN q.scheduled_at IS NULL THEN 0 ELSE 1 END ASC,
                       q.scheduled_at ASC,
                       q.id ASC
                   ) AS campaign_turn
            FROM queue q
            JOIN campaigns c ON q.campaign_id = c.id
            WHERE q.status = 'queued'
              AND (q.scheduled_at IS NULL OR q.scheduled_at <= datetime('now', '+330 minutes'))
              AND c.status IN ('SCHEDULED', 'QUEUED', 'RUNNING')
          )
          SELECT * FROM RankedQueue
          ORDER BY 
            ${priorityOrderClause}
            campaign_turn ASC,
            id ASC
          LIMIT ?
        `).all(maxDispatchCount);

        if (!queueItems || queueItems.length === 0) {
          // Clean up any finished priority campaign IDs
          if (this.priorityCampaignIds.size > 0) {
            for (const pid of Array.from(this.priorityCampaignIds)) {
              const pending = db.prepare("SELECT COUNT(*) as c FROM queue WHERE campaign_id = ? AND status IN ('queued', 'sending')").get(pid).c;
              if (pending === 0) this.priorityCampaignIds.delete(pid);
            }
          }
          await this.interruptibleSleep(1000);
          continue;
        }

        // 3. Mark campaign as RUNNING for any active batch
        const campaignIds = [...new Set(queueItems.map(it => it.campaign_id))];
        for (const campId of campaignIds) {
          db.prepare(`
            UPDATE campaigns
            SET status = 'RUNNING',
                started_at = COALESCE(started_at, datetime('now', '+330 minutes'))
            WHERE id = ? AND status IN ('SCHEDULED', 'QUEUED')
          `).run(campId);
        }

        // 4. Parallel Dispatch across leased accounts
        const assignedAccountIds = new Set();

        const dispatchPromises = queueItems.map(async (item, idx) => {
          // Match account respecting campaign policy:
          // Pinned account is STRICT: only that account sends, no leak to other pool accounts.
          // Fallback to pool ONLY when campaign explicitly allows it (fallback_allowed = 1).
          let account = null;

          if (item.campaign_pinned_account_id) {
            // Pinned/selected sender: Find it in available accounts.
            // DELIBERATELY skip assignedAccountIds check — same pinned account can handle
            // multiple emails in the same dispatch cycle. This prevents "leak" where
            // selecting 1 sender still rotated through all pool accounts.
            account = availableAccounts.find(a => a.id === item.campaign_pinned_account_id);

            if (!account && item.campaign_fallback_allowed === 1) {
              // Fallback ONLY if campaign explicitly allows it (user opted in)
              account = availableAccounts.find(a => !assignedAccountIds.has(a.id)) || availableAccounts[idx % availableAccounts.length];
              if (account) {
                console.log(`[QueueWorker] 🔄 Pinned sender (ID: ${item.campaign_pinned_account_id}) unavailable. Fallback allowed — using pool account: ${account.email}`);
              }
            } else if (!account) {
              // Pinned account not available and fallback NOT allowed — postpone, don't leak!
              console.log(`[QueueWorker] ⏳ Pinned sender (ID: ${item.campaign_pinned_account_id}) unavailable (cooldown/quota). Fallback disabled — postponing "${item.email}" 60s.`);
              db.prepare(`
                UPDATE queue
                SET scheduled_at = datetime('now', '+330 minutes', '+60 seconds'),
                    last_error = 'Pinned sender unavailable. Waiting for cooldown/quota refresh (no fallback).'
                WHERE id = ?
              `).run(item.id);
              return;
            }
          } else {
            // General pool rotation: Fair round-robin across healthy accounts
            account = availableAccounts.find(a => !assignedAccountIds.has(a.id)) || availableAccounts[idx % availableAccounts.length];
          }

          if (!account) {
            // Anti-Deadlock Guard: Postpone this item by 60s in IST so it doesn't starve the head of the queue on every tick
            db.prepare(`
              UPDATE queue
              SET scheduled_at = datetime('now', '+330 minutes', '+60 seconds'),
                  last_error = 'All eligible senders busy or reached daily limits. Postponed 60s.'
              WHERE id = ?
            `).run(item.id);
            return;
          }
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
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sending', datetime('now', '+330 minutes'), datetime('now', '+330 minutes'), datetime('now', '+330 minutes'), ?)
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
            SET last_sent_at = datetime('now', '+330 minutes')
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
            }, true);
            const dynamicHtml = renderTemplate(item.rendered_html, {
              sender_email: account.email,
              email: item.email,
              name: item.name
            }, false);

            // Auto-detect and bind inline CID image attachments for visual cards
            const attachments = [];
            for (const [cid, meta] of Object.entries(VISUAL_CID_ATTACHMENTS)) {
              if (dynamicHtml.includes(`cid:${cid}`) && fs.existsSync(meta.path)) {
                attachments.push(meta);
              }
            }

            if (account.provider === 'AZURE_ACS') {
              try {
                await withTimeout(sendViaACS({
                  fromEmail: account.email,
                  toEmail: item.email,
                  subject: dynamicSubject,
                  htmlBody: dynamicHtml
                }), 10000, 'Azure ACS dispatch');
              } catch (acsErr) {
                console.warn(`[QueueWorker] ⚠️ Azure ACS dispatch failed for "${item.email}": ${acsErr.message}. Automatically failing over to OCI SMTP...`);
                // Find a healthy OCI account to seamlessly complete delivery
                const ociAccount = db.prepare(`
                  SELECT * FROM accounts
                  WHERE provider = 'OCI' AND is_active = 1 AND sent_today < daily_limit
                  ORDER BY sent_today ASC, id ASC
                  LIMIT 1
                `).get();

                if (ociAccount) {
                  await withTimeout(sendViaOCI({
                    fromEmail: ociAccount.email,
                    toEmail: item.email,
                    subject: dynamicSubject,
                    htmlBody: dynamicHtml,
                    region: ociAccount.oci_region || 'auto',
                    attachments
                  }), 15000, 'OCI Failover dispatch');
                  account = ociAccount; // Re-bind account so metrics attribute correctly
                } else {
                  throw acsErr; // Rethrow if no fallback available
                }
              }
            } else if (account.provider === 'OCI') {
              await withTimeout(sendViaOCI({
                fromEmail: account.email,
                toEmail: item.email,
                subject: dynamicSubject,
                htmlBody: dynamicHtml,
                region: account.oci_region || 'auto',
                attachments
              }), 15000, 'OCI SMTP dispatch');
            } else if (account.provider === 'MAILGUN') {
              await withTimeout(sendViaMailgun({
                fromEmail: account.email,
                toEmail: item.email,
                subject: dynamicSubject,
                htmlBody: dynamicHtml
              }), 15000, 'Mailgun API dispatch');
            } else {
              await withTimeout(sendViaGraph({
                fromEmail: account.email,
                toEmail: item.email,
                subject: dynamicSubject,
                htmlBody: dynamicHtml
              }), 15000, 'Microsoft Graph dispatch');
            }

            // Record Success
            db.prepare(`
              UPDATE queue
              SET status = 'sent',
                  sent_at = datetime('now', '+330 minutes'),
                  accepted_at = datetime('now', '+330 minutes'),
                  provider_message_id = COALESCE(provider_message_id, 'msg_' || hex(randomblob(8))),
                  last_error = ''
              WHERE id = ?
            `).run(item.id);

            // Detailed Delivery Audit Log: Record Success
            try {
              db.prepare(`
                UPDATE delivery_logs 
                SET status = 'sent', 
                    completed_at = datetime('now', '+330 minutes'),
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
            this.checkCampaignCompletion(item.campaign_id, item.campaign_name);

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

            } else if (
              dispatchErr.message && (
                dispatchErr.message.includes('time difference between the originating client and the server') ||
                dispatchErr.message.includes('AADSTS700024') ||
                dispatchErr.message.includes('GRAPH_FORBIDDEN_403') ||
                dispatchErr.message.includes('ClientSecretCredential') ||
                dispatchErr.message.includes('Authentication') ||
                dispatchErr.statusCode === 401 ||
                dispatchErr.statusCode === 403
              )
            ) {
              const cooldownSeconds = 600; // 10 minutes cooldown for broken auth/clock-skew accounts
              console.warn(`[QueueWorker] ⚠️ Account ${account.email} failed with auth/clock-skew: "${dispatchErr.message}". Applying ${cooldownSeconds}s cooldown. Rotating "${item.email}" immediately to healthy accounts.`);
              AccountPool.putOnCooldown(account.id, cooldownSeconds);

              // Requeue immediately with NO backoff and restore attempt so healthy account gets clean shot
              db.prepare(`
                UPDATE queue
                SET status = 'queued',
                    scheduled_at = datetime('now', '+330 minutes'),
                    account_id = NULL,
                    attempts = MAX(0, attempts - 1),
                    last_error = ?
                WHERE id = ?
              `).run(`Sender Auth/Clock Skew: ${dispatchErr.message}`, item.id);

              db.prepare(`
                INSERT INTO logs (campaign_id, account_id, level, message)
                VALUES (?, ?, 'ERROR', ?)
              `).run(item.campaign_id, account.id, `Sender account ${account.email} cooled down ${cooldownSeconds}s due to auth/clock-skew. Requeued for other pool senders.`);

            } else {
              // Single-try rule: No time wasting on repeated timeouts when alternative healthy senders exist!
              const isAcsTimeout = dispatchErr.message && dispatchErr.message.includes('Azure ACS dispatch timed out');
              if (isAcsTimeout) {
                console.warn(`[QueueWorker] ⚠️ ACS Timeout on ${account.email}. Applying 600s cooldown so pool switches to healthy senders immediately.`);
                AccountPool.putOnCooldown(account.id, 600);
              }

              const maxAttempts = 1; // Strict 1 attempt to avoid stalling the pipeline
              const isPermanent = (item.attempts + 1) >= maxAttempts || dispatchErr.statusCode === 404;

              db.prepare(`
                UPDATE queue
                SET status = ?,
                    scheduled_at = NULL,
                    account_id = NULL,
                    attempts = attempts + 1,
                    last_error = ?
                WHERE id = ?
              `).run(isPermanent ? 'failed' : 'queued', dispatchErr.message, item.id);

              // Detailed Delivery Audit Log: Record Failure
              try {
                db.prepare(`
                  UPDATE delivery_logs 
                  SET status = ?, 
                      completed_at = datetime('now', '+330 minutes'),
                      error_message = ?,
                      attempts = attempts + 1
                  WHERE queue_id = ?
                `).run(isPermanent ? 'failed' : 'queued', dispatchErr.message || 'Unknown error', item.id);
              } catch (_) {}

              if (isPermanent) {
                db.prepare(`
                  UPDATE campaigns
                  SET failed_count = failed_count + 1
                  WHERE id = ?
                `).run(item.campaign_id);

                // Check if campaign is now completed
                this.checkCampaignCompletion(item.campaign_id, item.campaign_name);
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

        // 6. Balanced batch pacing delay: ultra-fast 100ms when priority Send-Now campaigns active, else configured interval
        const hasPriority = this.priorityCampaignIds.size > 0;
        const pacingMs = hasPriority ? 100 : Math.max(500, Math.min(getSendIntervalMs(), 2000));
        await this.interruptibleSleep(pacingMs);

      } catch (loopErr) {
        console.error('[QueueWorker] Unexpected error in worker tick:', loopErr);
        await this.interruptibleSleep(2000);
      }
    }
  }

  getStatus() {
    // ponytail: avoid full table scan of queue (O(Q) at crore scale = frozen server).
    // Count only active items from queue (small set, indexed), derive sent/failed from campaigns.
    const active = db.prepare(`
      SELECT 
        COUNT(CASE WHEN status = 'queued' THEN 1 END) AS queued,
        COUNT(CASE WHEN status = 'sending' THEN 1 END) AS sending
      FROM queue
      WHERE status IN ('queued', 'sending')
    `).get();
    const agg = db.prepare(`
      SELECT COALESCE(SUM(sent_count), 0) AS sent, COALESCE(SUM(failed_count), 0) AS failed
      FROM campaigns
    `).get();
    const queueCounts = {
      queued: active.queued,
      sending: active.sending,
      sent: agg.sent,
      failed: agg.failed,
      total: active.queued + active.sending + agg.sent + agg.failed
    };

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
      const sendIntervalSec = getSendIntervalMs() / 1000;
      const etaSeconds = Math.round(remaining * sendIntervalSec);

      const targetCompletionDate = new Date(Date.now() + (etaSeconds * 1000));
      const estimatedCompletionIST = remaining > 0 ? formatISTClock(targetCompletionDate) : 'Now';
      const completionDurationText = formatDuration(etaSeconds);
      const dispatchedAt = activeCamp.started_at || (this.lastDispatchedAt ? toISTString(this.lastDispatchedAt) : null);

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
        dispatchedAt,
        estimatedCompletionIST,
        completionDurationText,
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
    `).all(activeId).map(c => {
      let scheduledAtFormatted = '--';
      if (c.scheduled_at) {
        const parsed = parseIST(c.scheduled_at);
        scheduledAtFormatted = parsed ? formatISTClock(parsed) : c.scheduled_at;
      }
      return {
        id: c.id,
        name: c.name,
        templateName: c.template_name || 'Standard Template',
        status: c.status,
        totalCount: c.total_count,
        scheduledAt: c.scheduled_at,
        scheduledAtFormatted
      };
    });

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
