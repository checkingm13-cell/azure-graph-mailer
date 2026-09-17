const db = require('../db');
const { renderTemplate } = require('./templateEngine');

class BatchChainManager {
  /**
   * Check if current batch completed and auto-start next
   */
  async checkAndTriggerNextBatch(campaignId, completedBatchNumber) {
    const nextBatchNumber = completedBatchNumber + 1;
    
    // Check if next batch exists in scheduled queue
    const nextBatch = db.prepare(`
      SELECT c.*, COUNT(q.id) as total_items
      FROM campaigns c
      LEFT JOIN queue q ON q.campaign_id = c.id
      WHERE c.name LIKE ? 
      AND c.status IN ('SCHEDULED', 'QUEUED')
      GROUP BY c.id
      ORDER BY c.scheduled_at ASC
      LIMIT 1
    `).get(`%_Batch_${String(nextBatchNumber).padStart(2, '0')}`);
    
    if (!nextBatch) {
      console.log(`[BatchChain] No next batch #${nextBatchNumber} found.`);
      return null;
    }
    
    // Auto-start the next batch
    return await this.startBatch(nextBatch.id);
  }
  
  /**
   * Start a batch immediately
   */
  async startBatch(campaignId) {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }
    
    // Update campaign status to RUNNING
    db.prepare(`
      UPDATE campaigns 
      SET status = 'RUNNING', 
          started_at = datetime('now'),
          scheduled_at = NULL
      WHERE id = ?
    `).run(campaignId);
    
    // Update queue items to queued status (remove scheduled_at constraint)
    db.prepare(`
      UPDATE queue 
      SET status = 'queued',
          scheduled_at = NULL
      WHERE campaign_id = ? 
      AND status = 'queued'
    `).run(campaignId);
    
    // Log the auto-start
    try {
      db.prepare(`
        INSERT INTO logs (campaign_id, level, message)
        VALUES (?, 'INFO', ?)
      `).run(campaignId, `Auto-started batch #${campaignId} via batch chain manager`);
    } catch (_) {}
    
    console.log(`[BatchChain] ✅ Auto-started campaign ${campaignId}: ${campaign.name}`);
    
    return {
      campaignId,
      name: campaign.name,
      totalCount: campaign.total_count,
      startedAt: new Date().toISOString()
    };
  }
  
  /**
   * Create chained batches from contacts
   */
  createChainedBatches({
    baseCampaignName,
    templateId,
    contacts,
    batchSize = 50,
    startImmediately = false,
    staggerMinutes = 0,
    senderAccountId = null
  }) {
    const totalBatches = Math.ceil(contacts.length / batchSize);
    const createdCampaigns = [];
    
    const insertCampaign = db.prepare(`
      INSERT INTO campaigns (
        name, template_id, status, total_count, scheduled_at,
        sender_account_id, mode, fallback_allowed, sending_speed, custom_interval_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertQueue = db.prepare(`
      INSERT INTO queue (campaign_id, contact_id, email, name, subject, rendered_html, status, scheduled_at, template_id)
      VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
    `);
    
    const upsertContact = db.prepare(`
      INSERT INTO contacts (email, name, paper_title, affiliation)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        name = CASE WHEN excluded.name != '' THEN excluded.name ELSE contacts.name END,
        paper_title = CASE WHEN excluded.paper_title != '' THEN excluded.paper_title ELSE contacts.paper_title END,
        affiliation = CASE WHEN excluded.affiliation != '' THEN excluded.affiliation ELSE contacts.affiliation END
    `);
    
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
    
    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }
    
    for (let i = 0; i < totalBatches; i++) {
      const start = i * batchSize;
      const batchContacts = contacts.slice(start, start + batchSize);
      const batchNumStr = String(i + 1).padStart(2, '0');
      const batchName = `${baseCampaignName}_Batch_${batchNumStr}`;
      
      // Calculate scheduled time
      let scheduledAt = null;
      if (!startImmediately && staggerMinutes > 0) {
        const scheduledTime = new Date(Date.now() + (i * staggerMinutes * 60 * 1000));
        scheduledAt = scheduledTime.toISOString().replace('T', ' ').slice(0, 19);
      }
      
      const status = (startImmediately && i === 0) ? 'RUNNING' : 'SCHEDULED';
      
      // Insert campaign
      const campRes = insertCampaign.run(
        batchName,
        templateId,
        status,
        batchContacts.length,
        scheduledAt,
        senderAccountId,
        'SMART',
        1,
        'BALANCED',
        2500
      );
      
      const campaignId = campRes.lastInsertRowid;
      
      // Insert queue items
      for (const contact of batchContacts) {
        upsertContact.run(
          contact.email,
          contact.name || '',
          contact.paper_title || '',
          contact.affiliation || ''
        );
        
        const contactRecord = db.prepare('SELECT id FROM contacts WHERE email = ?').get(contact.email);
        
        const renderedSubject = renderTemplate(template.subject, contact);
        const renderedBody = renderTemplate(template.body_html, contact);
        
        insertQueue.run(
          campaignId,
          contactRecord ? contactRecord.id : null,
          contact.email,
          contact.name || '',
          renderedSubject,
          renderedBody,
          scheduledAt,
          templateId
        );
      }
      
      createdCampaigns.push({
        campaignId,
        name: batchName,
        status,
        totalCount: batchContacts.length,
        scheduledAt,
        batchNumber: i + 1
      });
    }
    
    // Log chain creation
    try {
      db.prepare(`
        INSERT INTO logs (campaign_id, level, message)
        VALUES (?, 'INFO', ?)
      `).run(createdCampaigns[0].campaignId, 
        `Created batch chain: ${totalBatches} batches, ${contacts.length} total contacts`
      );
    } catch (_) {}
    
    return {
      totalBatches,
      totalContacts: contacts.length,
      campaigns: createdCampaigns,
      firstBatchId: startImmediately ? createdCampaigns[0].campaignId : null
    };
  }
  
  /**
   * Monitor for completed batches and trigger next
   */
  async monitorBatchCompletion() {
    // 1. Auto-Reconciliation: If a queue item has a persistent clock-skew or invalid connection string error, mark it failed so it does not permanently block 49/50 batches
    try {
      db.prepare(`
        UPDATE queue
        SET status = 'failed',
            last_error = 'Auto-resolved: ' || COALESCE(last_error, 'Persistent dispatch error')
        WHERE status = 'queued'
          AND attempts >= 1
          AND (
            last_error LIKE '%The given request could not be resolved%'
            OR last_error LIKE '%time difference between the originating client and the server%'
            OR last_error LIKE '%AADSTS700024%'
            OR last_error LIKE '%Invalid connection string%'
          )
      `).run();

      // Re-sync failed_count on all RUNNING campaigns based on actual failed queue items
      db.prepare(`
        UPDATE campaigns
        SET failed_count = (SELECT COUNT(*) FROM queue WHERE queue.campaign_id = campaigns.id AND queue.status = 'failed')
        WHERE status = 'RUNNING'
      `).run();
    } catch (e) {
      console.error('[BatchChain] Error in auto-reconciliation:', e);
    }

    const completedBatches = db.prepare(`
      SELECT c.id, c.name, c.total_count, c.sent_count, c.failed_count
      FROM campaigns c
      WHERE c.status = 'RUNNING'
      AND c.total_count > 0
      AND (
        (c.sent_count + COALESCE(c.failed_count, 0)) >= c.total_count
        OR (SELECT COUNT(*) FROM queue q WHERE q.campaign_id = c.id AND q.status IN ('queued', 'sending')) = 0
      )
    `).all();
    
    for (const batch of completedBatches) {
      db.prepare(`
        UPDATE campaigns 
        SET status = 'COMPLETED',
            completed_at = datetime('now')
        WHERE id = ? AND status = 'RUNNING'
      `).run(batch.id);
      
      console.log(`[BatchChain] ✅ Batch completed: ${batch.name}`);
      
      // Extract batch number from name
      const match = batch.name.match(/Batch_(\d+)/);
      if (match) {
        const batchNumber = parseInt(match[1], 10);
        await this.checkAndTriggerNextBatch(batch.id, batchNumber);
      }
    }
  }
  
  /**
   * Get chain status
   */
  getChainStatus(baseCampaignName) {
    const batches = db.prepare(`
      SELECT 
        c.id,
        c.name,
        c.status,
        c.total_count,
        c.sent_count,
        c.failed_count,
        c.scheduled_at,
        c.started_at,
        c.completed_at,
        ROUND((c.sent_count * 100.0 / c.total_count), 2) as progress_pct
      FROM campaigns c
      WHERE c.name LIKE ?
      ORDER BY c.scheduled_at ASC, c.id ASC
    `).all(`${baseCampaignName}%`);
    
    const completed = batches.filter(b => b.status === 'COMPLETED').length;
    const running = batches.filter(b => b.status === 'RUNNING').length;
    const scheduled = batches.filter(b => b.status === 'SCHEDULED').length;
    
    return {
      baseName: baseCampaignName,
      totalBatches: batches.length,
      completed,
      running,
      scheduled,
      progress: batches.length > 0 
        ? Math.round((completed / batches.length) * 100) 
        : 0,
      batches
    };
  }
}

module.exports = new BatchChainManager();
