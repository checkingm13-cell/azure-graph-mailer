const express = require('express');
const router = express.Router();
const batchChainManager = require('../services/batchChainManager');
const db = require('../db');

// Create chained batches from CSV
router.post('/create-chain', async (req, res) => {
  try {
    const {
      baseCampaignName,
      templateId,
      contacts,
      batchSize = 50,
      startImmediately = true,
      staggerMinutes = 0,
      senderAccountId = null
    } = req.body;
    
    if (!contacts || contacts.length === 0) {
      return res.status(400).json({ ok: false, error: 'No contacts provided' });
    }
    
    const result = batchChainManager.createChainedBatches({
      baseCampaignName,
      templateId,
      contacts,
      batchSize,
      startImmediately,
      staggerMinutes,
      senderAccountId
    });
    
    res.json({
      ok: true,
      message: `Created ${result.totalBatches} batches with ${result.totalContacts} contacts`,
      ...result
    });
  } catch (err) {
    console.error('[BatchChain API] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Get chain status
router.get('/chain-status/:baseName', (req, res) => {
  try {
    const status = batchChainManager.getChainStatus(req.params.baseName);
    res.json({ ok: true, ...status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Manually trigger next batch
router.post('/trigger-next/:campaignId', async (req, res) => {
  try {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.campaignId);
    
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Campaign not found' });
    }
    
    // Extract batch number
    const match = campaign.name.match(/Batch_(\d+)/);
    if (!match) {
      return res.status(400).json({ ok: false, error: 'Invalid campaign name format' });
    }
    
    const batchNumber = parseInt(match[1], 10);
    const result = await batchChainManager.checkAndTriggerNextBatch(
      req.params.campaignId,
      batchNumber
    );
    
    if (!result) {
      return res.json({ 
        ok: true, 
        message: 'No next batch found in queue',
        completed: true 
      });
    }
    
    res.json({
      ok: true,
      message: 'Next batch started successfully',
      ...result
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Cancel entire chain
router.post('/cancel-chain/:baseName', (req, res) => {
  try {
    const { baseName } = req.params;
    
    const campaigns = db.prepare(`
      SELECT id FROM campaigns WHERE name LIKE ?
    `).all(`${baseName}%`);
    
    let cancelled = 0;
    for (const camp of campaigns) {
      db.prepare(`
        UPDATE campaigns 
        SET status = 'CANCELLED',
            completed_at = datetime('now')
        WHERE id = ? AND status IN ('SCHEDULED', 'QUEUED', 'RUNNING')
      `).run(camp.id);
      
      db.prepare(`
        UPDATE queue 
        SET status = 'failed',
            last_error = 'Chain cancelled by user'
        WHERE campaign_id = ? AND status = 'queued'
      `).run(camp.id);
      
      cancelled++;
    }
    
    res.json({
      ok: true,
      message: `Cancelled ${cancelled} batches in chain`,
      cancelled
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
