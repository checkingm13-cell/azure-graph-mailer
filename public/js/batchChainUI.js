// Auto-refresh chain status
async function refreshChainStatus(baseName) {
  try {
    const res = await fetch(`/api/batch-chain/chain-status/${encodeURIComponent(baseName)}`);
    const data = await res.json();
    
    if (data.ok) {
      updateChainDashboard(data);
    }
  } catch (err) {
    console.error('Error refreshing chain:', err);
  }
}

function updateChainDashboard(chainData) {
  const container = document.getElementById('chainStatusContainer');
  if (!container) return;
  
  container.innerHTML = `
    <div class="chain-header">
      <h3>Batch Chain: ${escapeHtml(chainData.baseName)}</h3>
      <div class="chain-progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${chainData.progress}%"></div>
        </div>
        <span>${chainData.progress}% Complete</span>
      </div>
      <div class="chain-stats">
        <span class="stat completed">✅ ${chainData.completed} Completed</span>
        <span class="stat running">⚡ ${chainData.running} Running</span>
        <span class="stat scheduled">📅 ${chainData.scheduled} Scheduled</span>
      </div>
    </div>
    <div class="batches-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-top: 12px;">
      ${(chainData.batches || []).map(batch => `
        <div class="batch-card ${batch.status.toLowerCase()}" style="background: var(--bg-surface); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color);">
          <div class="batch-name" style="font-weight: 600; color: var(--sky); font-size: 12px;">${escapeHtml(batch.name)}</div>
          <div class="batch-progress" style="font-size: 11px; margin: 4px 0;">${batch.sent_count}/${batch.total_count}</div>
          <div class="batch-status"><span class="badge badge-${batch.status.toLowerCase()}">${batch.status}</span></div>
          ${batch.status === 'COMPLETED' && batch.completed_at ? 
            `<div class="batch-time" style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Completed: ${new Date(batch.completed_at).toLocaleTimeString()}</div>` : ''}
          ${batch.status === 'RUNNING' ? 
            `<button onclick="triggerNextBatch(${batch.id})" class="btn btn-xs btn-primary" style="margin-top: 6px;">Trigger Next</button>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

async function triggerNextBatch(campaignId) {
  try {
    const res = await fetch(`/api/batch-chain/trigger-next/${campaignId}`, {
      method: 'POST'
    });
    const data = await res.json();
    
    if (data.ok) {
      alert('Next batch started!');
      if (window.currentChainName) refreshChainStatus(window.currentChainName);
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    alert('Error triggering next batch: ' + err.message);
  }
}

window.refreshChainStatus = refreshChainStatus;
window.triggerNextBatch = triggerNextBatch;

// Auto-refresh every 10 seconds if a chain is active
setInterval(() => {
  const currentChain = window.currentChainName;
  if (currentChain) {
    refreshChainStatus(currentChain);
  }
}, 10000);
