/**
 * Frontend Application Controller for Azure Multi-Account Mailer
 * Upgraded with Extension Dashboard UI: Filtering, Sorting, Pagination & Diagnostics
 */
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const workerStateBadge = document.getElementById('workerStateBadge');
  const workerStatusText = document.getElementById('workerStatusText');
  const btnToggleWorker = document.getElementById('btnToggleWorker');
  const statDailyCapacity = document.getElementById('statDailyCapacity');
  const statSentToday = document.getElementById('statSentToday');
  const statQueuePending = document.getElementById('statQueuePending');
  const statQueueSending = document.getElementById('statQueueSending');
  const statTotalContacts = document.getElementById('statTotalContacts');
  const accountsPoolGrid = document.getElementById('accountsPoolGrid');
  const queueTableBody = document.getElementById('queueTableBody');
  const badgeQueueTotal = document.getElementById('badgeQueueTotal');
  const accountsTableBody = document.getElementById('accountsTableBody');
  const badgeAccountCount = document.getElementById('badgeAccountCount');
  const formAddAccount = document.getElementById('formAddAccount');
  const editAccountId = document.getElementById('editAccountId');
  const accountFormTitle = document.getElementById('accountFormTitle');
  const btnSubmitAccount = document.getElementById('btnSubmitAccount');
  const btnCancelEditAccount = document.getElementById('btnCancelEditAccount');
  const accEmailHelp = document.getElementById('accEmailHelp');
  let allLoadedAccounts = [];
  const campaignsTableBody = document.getElementById('campaignsTableBody');
  const formTemplate = document.getElementById('formTemplate');
  const tplId = document.getElementById('tplId');
  const tplName = document.getElementById('tplName');
  const tplSubject = document.getElementById('tplSubject');
  const tplBody = document.getElementById('tplBody');
  const btnResetTemplate = document.getElementById('btnResetTemplate');
  const templatesList = document.getElementById('templatesList');
  const dropZone = document.getElementById('dropZone');
  const csvFileInput = document.getElementById('csvFileInput');
  const selectedFileName = document.getElementById('selectedFileName');
  const btnUploadCsv = document.getElementById('btnUploadCsv');
  const formUploadCsv = document.getElementById('formUploadCsv');
  const contactsTableBody = document.getElementById('contactsTableBody');
  const badgeContactTotal = document.getElementById('badgeContactTotal');
  const terminalLogs = document.getElementById('terminalLogs');
  const btnRefreshLogs = document.getElementById('btnRefreshLogs');

  // Live Hero Monitor Elements
  const monitorStatusBadge = document.getElementById('monitorStatusBadge');
  const monitorCampaignName = document.getElementById('monitorCampaignName');
  const btnMonitorPause = document.getElementById('btnMonitorPause');
  const btnMonitorResume = document.getElementById('btnMonitorResume');
  const btnMonitorCancel = document.getElementById('btnMonitorCancel');
  const monitorProgressBar = document.getElementById('monitorProgressBar');
  const monitorProgressText = document.getElementById('monitorProgressText');
  const monitorSenderEmail = document.getElementById('monitorSenderEmail');
  const monitorEtaText = document.getElementById('monitorEtaText');
  const monitorCurrentRecipient = document.getElementById('monitorCurrentRecipient');
  const monitorUpcomingContainer = document.getElementById('monitorUpcomingContainer');
  const monitorUpcomingList = document.getElementById('monitorUpcomingList');

  // Scheduling Inputs
  const campaignScheduleMode = document.getElementById('campaignScheduleMode');
  const groupScheduledStartTime = document.getElementById('groupScheduledStartTime');
  const campaignScheduledStartTime = document.getElementById('campaignScheduledStartTime');
  const groupStaggerInterval = document.getElementById('groupStaggerInterval');
  const campaignStaggerMinutes = document.getElementById('campaignStaggerMinutes');

  // Campaign Table State & View Mode
  let allCampaigns = [];
  let currentCampFilter = 'ALL';
  let campSearchQuery = '';
  let campSortOrder = 'newest';
  let campPageSize = 50;
  let campCurrentPage = 1;
  let campaignViewMode = 'aggregated'; // 'aggregated' (Parent-Child) or 'table' (Raw)

  // Smooth EMA Throughput Tracker
  let currentThroughput = 0;
  let lastSentCount = 0;
  let lastCheckTime = Date.now();

  function updateThroughputTicker(currentSentCount) {
    const now = Date.now();
    const timeDeltaSec = (now - lastCheckTime) / 1000;
    
    if (timeDeltaSec > 0 && lastSentCount > 0) {
      const instantRate = Math.max(0, (currentSentCount - lastSentCount) / timeDeltaSec);
      currentThroughput = (0.35 * instantRate) + (0.65 * currentThroughput);
    }
    
    lastSentCount = currentSentCount;
    lastCheckTime = now;
    
    const throughputEl = document.getElementById('throughputTicker');
    if (throughputEl) {
      throughputEl.textContent = currentThroughput > 0.05 ? `⚡ ${currentThroughput.toFixed(1)} emails/sec` : '⚡ Idle (0.0/s)';
    }
  }

  // Dynamic Pacing Delay Controls
  const inputSendInterval = document.getElementById('inputSendInterval');
  const btnSaveInterval = document.getElementById('btnSaveInterval');

  async function loadSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.ok && inputSendInterval) {
        inputSendInterval.value = data.sendIntervalMs;
      }
    } catch (e) {}
  }
  loadSettings();

  if (btnSaveInterval) {
    btnSaveInterval.addEventListener('click', async () => {
      const val = parseInt(inputSendInterval.value, 10);
      if (isNaN(val) || val < 10) return alert('Please enter a valid delay in milliseconds (min 10ms)');
      btnSaveInterval.disabled = true;
      btnSaveInterval.textContent = 'Saving...';
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sendIntervalMs: val })
        });
        const data = await res.json();
        if (data.ok) {
          btnSaveInterval.textContent = 'Saved!';
          setTimeout(() => {
            btnSaveInterval.textContent = 'Save';
            btnSaveInterval.disabled = false;
          }, 1500);
        } else {
          alert(data.error || 'Failed to save');
          btnSaveInterval.disabled = false;
        }
      } catch (e) {
        alert(e.message);
        btnSaveInterval.disabled = false;
      }
    });
  }

  // 1-Click OCI Pacing Presets
  const btnPresetSandbox = document.getElementById('btnPresetSandbox');
  const btnPresetEnterprise = document.getElementById('btnPresetEnterprise');

  async function applyPacingPreset(val, btn) {
    if (inputSendInterval) inputSendInterval.value = val;
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendIntervalMs: val })
      });
      const data = await res.json();
      if (data.ok && btnSaveInterval) {
        btnSaveInterval.textContent = 'Saved!';
        setTimeout(() => { btnSaveInterval.textContent = 'Save'; }, 1200);
      }
    } catch (e) {}
    if (btn) btn.disabled = false;
  }

  if (btnPresetSandbox) {
    btnPresetSandbox.addEventListener('click', () => applyPacingPreset(6500, btnPresetSandbox));
  }
  if (btnPresetEnterprise) {
    btnPresetEnterprise.addEventListener('click', () => applyPacingPreset(100, btnPresetEnterprise));
  }

  // Auto-presets & connection-specific hints on provider dropdown change
  const accProviderSelect = document.getElementById('accProvider');
  const accProviderHelp = document.getElementById('accProviderHelp');
  const accDailyLimitInput = document.getElementById('accDailyLimit');
  const accCooldownInput = document.getElementById('accCooldown');
  const accEmailInput = document.getElementById('accEmail');

  function updateProviderHelp(provider) {
    if (!accProviderHelp) return;
    if (provider === 'OCI') {
      accProviderHelp.innerHTML = '🏛️ <strong>Oracle Cloud Infrastructure (OCI)</strong>: Direct SMTP Relay (Port 587). Enterprise PAYG: 1,500+ msgs/sec. Safe limits: 2k to 50k+/day, 0s cooldown.';
    } else if (provider === 'AZURE_ACS') {
      accProviderHelp.innerHTML = '⚡ <strong>Azure Communication Services (ACS)</strong>: Cloud REST SDK. Throughput: 100 msgs/sec. Safe limits: 10k to 100k+/day, 0s cooldown.';
    } else {
      accProviderHelp.innerHTML = '🔷 <strong>Microsoft Graph API</strong>: Mailbox REST API. Hard cap: 30 msgs/min per mailbox. Safe limits: 250 to 2,000/day, 60s cooldown.';
    }
  }

  if (accProviderSelect) {
    accProviderSelect.addEventListener('change', () => {
      const p = accProviderSelect.value;
      updateProviderHelp(p);

      // Only pre-fill defaults when adding a new account, never overwrite custom numbers in edit mode
      if (editAccountId && editAccountId.value) return;

      if (p === 'OCI') {
        if (accDailyLimitInput) accDailyLimitInput.value = 10000;
        if (accCooldownInput) accCooldownInput.value = 0;
        if (accEmailInput && !accEmailInput.value) {
          accEmailInput.placeholder = 'editor@education.yourpaperpublication.com';
        }
      } else if (p === 'AZURE_ACS') {
        if (accDailyLimitInput) accDailyLimitInput.value = 10000;
        if (accCooldownInput) accCooldownInput.value = 0;
        if (accEmailInput && !accEmailInput.value) {
          accEmailInput.placeholder = 'DoNotReply@mail.theparipexjournal.com';
        }
      } else {
        if (accDailyLimitInput) accDailyLimitInput.value = 500;
        if (accCooldownInput) accCooldownInput.value = 60;
        if (accEmailInput && !accEmailInput.value) {
          accEmailInput.placeholder = 'editor@yourpaperdomain.com';
        }
      }
    });
  }

  function formatTimeUntil(dateStr) {
    if (!dateStr) return '--';
    const cleanStr = dateStr.includes('Z') || dateStr.includes('+') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
    const target = new Date(cleanStr);
    const now = new Date();
    const diffMs = target.getTime() - now.getTime();
    if (diffMs <= 0) return 'due now';
    const diffMins = Math.round(diffMs / 60000);
    if (diffMins < 60) return `in ${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    const remMins = diffMins % 60;
    return `in ${diffHours}h ${remMins}m`;
  }

  function formatDateTime(dateStr) {
    if (!dateStr) return '--';
    const cleanStr = dateStr.includes('Z') || dateStr.includes('+') ? dateStr : dateStr.replace(' ', 'T') + 'Z';
    const d = new Date(cleanStr);
    return isNaN(d.getTime()) ? dateStr : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // 1. TAB NAVIGATION WITH ASYNC LAZY LOADING
  const loadedTabs = new Set(['tab-overview']); // Overview loaded on boot

  function switchTab(targetId) {
    document.querySelectorAll('.nav-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
    const tabBtn = document.querySelector(`.nav-tab[data-tab="${targetId}"]`);
    if (tabBtn) tabBtn.classList.add('active');
    document.getElementById(targetId)?.classList.add('active');

    // Lazy load tab data on first visit
    if (!loadedTabs.has(targetId)) {
      loadedTabs.add(targetId);
      if (targetId === 'tab-accounts') loadAccounts();
      if (targetId === 'tab-templates') loadTemplates();
      if (targetId === 'tab-campaigns') { loadTemplates(); loadCampaigns(); }
      if (targetId === 'tab-contacts') loadContacts();
      if (targetId === 'tab-logs') {
        loadDetailedLogs();
        loadCampaignsForLogsFilter();
      }
    } else {
      // Re-trigger fast lightweight refresh if needed
      if (targetId === 'tab-accounts') loadAccounts();
      if (targetId === 'tab-campaigns') loadCampaigns();
    }
  }
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => { switchTab(tab.dataset.tab); });
  });

  // 2. TAG PILLS CLICK
  document.querySelectorAll('.tag-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const targetInput = document.getElementById(pill.dataset.target);
      if (targetInput) {
        const tag = pill.dataset.tag;
        const start = targetInput.selectionStart || targetInput.value.length;
        const end = targetInput.selectionEnd || targetInput.value.length;
        targetInput.value = targetInput.value.substring(0, start) + tag + targetInput.value.substring(end);
        targetInput.focus();
        targetInput.setSelectionRange(start + tag.length, start + tag.length);
      }
    });
  });

  // 3. TELEMETRY & POLLING
  async function refreshTelemetry() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (!data.ok) return;
      const { worker, pool } = data;

      // Worker status
      isWorkerPaused = worker.isPaused;
      if (worker.isPaused) {
        workerStateBadge.className = 'status-badge paused';
        workerStatusText.textContent = 'WORKER PAUSED';
        btnToggleWorker.textContent = '▶️ Resume Worker';
      } else {
        workerStateBadge.className = 'status-badge active';
        workerStatusText.textContent = 'WORKER ACTIVE';
        btnToggleWorker.textContent = '⏸️ Pause Worker';
      }

      // Smooth EMA Throughput Calculation
      updateThroughputTicker(pool.total_sent_today || 0);

      if (worker.sendIntervalMs && inputSendInterval && document.activeElement !== inputSendInterval) {
        inputSendInterval.value = worker.sendIntervalMs;
      }

      // Diagnostics Ribbon Updates
      const diagActivePool = document.getElementById('diagActivePool');
      const diagWorkerStatus = document.getElementById('diagWorkerStatus');
      const diagQuotaFuel = document.getElementById('diagQuotaFuel');
      const diagQuotaBar = document.getElementById('diagQuotaBar');

      if (diagActivePool) diagActivePool.textContent = `${pool.active_accounts || 0} / ${pool.total_accounts || 0} Ready`;
      if (diagWorkerStatus) {
        diagWorkerStatus.textContent = worker.isPaused ? 'PAUSED' : 'ACTIVE';
        diagWorkerStatus.className = `diag-value ${worker.isPaused ? 'text-amber' : 'text-emerald'}`;
      }
      if (diagQuotaFuel && diagQuotaBar) {
        const fuelPct = pool.total_daily_capacity > 0 ? Math.round((pool.total_sent_today / pool.total_daily_capacity) * 100) : 0;
        diagQuotaFuel.textContent = `${fuelPct}% Used`;
        diagQuotaBar.style.width = `${fuelPct}%`;
        diagQuotaBar.style.backgroundColor = fuelPct > 90 ? 'var(--rose)' : 'var(--emerald)';
      }

      // Pool summary
      statDailyCapacity.textContent = `${pool.total_daily_capacity || 0}`;
      statSentToday.textContent = `${pool.total_sent_today || 0} sent today (${pool.total_remaining_today || 0} remaining)`;
      statQueuePending.textContent = worker.queue.queued;
      statQueueSending.textContent = `${worker.queue.sending} currently in transit`;
      badgeQueueTotal.textContent = `${worker.queue.queued} waiting`;
      const countFailedBadge = document.getElementById('countFailedBadge');
      if (countFailedBadge) {
        countFailedBadge.textContent = worker.queue?.failed || 0;
      }
      loadQueue();

      // Live Campaign Monitor Hero Card
      if (monitorCampaignName) {
        const activeCamp = worker.activeCampaign;
        const upcoming = worker.upcomingCampaigns || [];
        if (activeCamp) {
          monitorCampaignName.textContent = `${activeCamp.name} (#${activeCamp.id})`;
          monitorProgressBar.style.width = `${activeCamp.progressPct}%`;
          monitorProgressText.textContent = `${activeCamp.sentCount} / ${activeCamp.totalCount} (${activeCamp.progressPct}%)`;
          monitorSenderEmail.textContent = activeCamp.activeSender || 'dr.reetashah@theparipexjournal.com';
          monitorCurrentRecipient.textContent = activeCamp.currentRecipient || '--';
          if (activeCamp.status === 'RUNNING') {
            monitorStatusBadge.className = 'badge badge-sending';
            monitorStatusBadge.textContent = '⚡ NOW RUNNING';
            if (btnMonitorPause) { btnMonitorPause.style.display = 'inline-block'; btnMonitorPause.dataset.id = activeCamp.id; }
            if (btnMonitorResume) btnMonitorResume.style.display = 'none';
            if (btnMonitorCancel) { btnMonitorCancel.style.display = 'inline-block'; btnMonitorCancel.dataset.id = activeCamp.id; }
            if (activeCamp.etaSeconds > 0) {
              monitorEtaText.textContent = activeCamp.etaSeconds < 60 ? `~${activeCamp.etaSeconds}s remaining` : `~${Math.ceil(activeCamp.etaSeconds / 60)} min remaining`;
            } else {
              monitorEtaText.textContent = 'Finishing batch...';
            }
          } else if (activeCamp.status === 'PAUSED') {
            monitorStatusBadge.className = 'badge badge-paused';
            monitorStatusBadge.textContent = '⏸️ PAUSED';
            if (btnMonitorPause) btnMonitorPause.style.display = 'none';
            if (btnMonitorResume) { btnMonitorResume.style.display = 'inline-block'; btnMonitorResume.dataset.id = activeCamp.id; }
            if (btnMonitorCancel) { btnMonitorCancel.style.display = 'inline-block'; btnMonitorCancel.dataset.id = activeCamp.id; }
            monitorEtaText.textContent = 'Paused by user';
          }

          // Fetch and display Operational Reason: "Why is my campaign waiting?"
          const reasonCard = document.getElementById('monitorReasonCard');
          const reasonText = document.getElementById('monitorReasonText');
          const countdownBadge = document.getElementById('monitorCountdownBadge');
          const countdownSec = document.getElementById('monitorCountdownSeconds');
          const nextAccountHint = document.getElementById('monitorNextAccountHint');
          const nextAccountName = document.getElementById('monitorNextAccountName');

          if (reasonCard && activeCamp.id) {
            fetch(`/api/campaigns/${activeCamp.id}/status-reason`)
              .then(r => r.json())
              .then(diag => {
                if (diag.ok && diag.reason) {
                  reasonCard.style.display = 'block';
                  reasonText.textContent = diag.reason;
                  if (diag.secondsRemaining && diag.secondsRemaining > 0) {
                    countdownBadge.style.display = 'inline-block';
                    countdownSec.textContent = diag.secondsRemaining;
                  } else {
                    countdownBadge.style.display = 'none';
                  }
                  if (diag.nextAvailableAccount) {
                    nextAccountHint.style.display = 'block';
                    nextAccountName.textContent = diag.nextAvailableAccount;
                  } else {
                    nextAccountHint.style.display = 'none';
                  }
                } else {
                  reasonCard.style.display = 'none';
                }
              }).catch(() => { reasonCard.style.display = 'none'; });
          }
        } else if (upcoming.length > 0) {
          const nextCamp = upcoming[0];
          monitorCampaignName.textContent = `Next Scheduled: ${nextCamp.name}`;
          monitorProgressBar.style.width = '0%';
          monitorProgressText.textContent = `0 / ${nextCamp.totalCount} (Waiting)`;
          monitorSenderEmail.textContent = 'dr.reetashah@theparipexjournal.com';
          monitorCurrentRecipient.textContent = 'Waiting for scheduled launch';
          monitorStatusBadge.className = 'badge badge-scheduled';
          monitorStatusBadge.textContent = '📅 SCHEDULED';
          monitorEtaText.textContent = `Starts ${formatTimeUntil(nextCamp.scheduledAt)}`;
          if (btnMonitorPause) btnMonitorPause.style.display = 'none';
          if (btnMonitorResume) btnMonitorResume.style.display = 'none';
          if (btnMonitorCancel) { btnMonitorCancel.style.display = 'inline-block'; btnMonitorCancel.dataset.id = nextCamp.id; }
          const reasonCard = document.getElementById('monitorReasonCard');
          if (reasonCard) reasonCard.style.display = 'none';
        } else {
          monitorCampaignName.textContent = 'No active campaign running';
          monitorProgressBar.style.width = '0%';
          monitorProgressText.textContent = '0 / 0 (Idle)';
          monitorSenderEmail.textContent = 'dr.reetashah@theparipexjournal.com';
          monitorCurrentRecipient.textContent = '--';
          monitorStatusBadge.className = 'badge badge-queued';
          monitorStatusBadge.textContent = 'IDLE';
          monitorEtaText.textContent = '--';
          if (btnMonitorPause) btnMonitorPause.style.display = 'none';
          if (btnMonitorResume) btnMonitorResume.style.display = 'none';
          if (btnMonitorCancel) btnMonitorCancel.style.display = 'none';
          const reasonCard = document.getElementById('monitorReasonCard');
          if (reasonCard) reasonCard.style.display = 'none';
        }

        // Upcoming Scheduled Queue Timeline
        if (upcoming.length > 0) {
          monitorUpcomingContainer.style.display = 'block';
          monitorUpcomingList.innerHTML = upcoming.map((u) => `
            <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 6px; padding: 8px 12px; min-width: 220px; font-size: 11px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <strong style="color: var(--text-primary); font-size: 12px;">${escapeHtml(u.name)}</strong>
                <span class="badge badge-scheduled">${formatTimeUntil(u.scheduledAt)}</span>
              </div>
              <div style="color: var(--text-muted);">${u.totalCount} emails &bull; ${formatDateTime(u.scheduledAt)}</div>
              <div style="margin-top: 6px; text-align: right;">
                <button type="button" class="btn btn-danger btn-sm btn-timeline-cancel" data-id="${u.id}" style="padding: 2px 8px; font-size: 10px;">Cancel</button>
              </div>
            </div>
          `).join('');
          monitorUpcomingList.querySelectorAll('.btn-timeline-cancel').forEach((btn) => {
            btn.addEventListener('click', async () => {
              if (!confirm('Cancel this scheduled batch?')) return;
              await fetch(`/api/campaigns/${btn.dataset.id}/cancel`, { method: 'POST' });
              refreshTelemetry();
              loadCampaigns();
            });
          });
        } else {
          monitorUpcomingContainer.style.display = 'none';
        }
      }
    } catch (_) { }
  }

  // Monitor Hero Buttons
  if (btnMonitorPause) {
    btnMonitorPause.addEventListener('click', async () => {
      const campId = btnMonitorPause.dataset.id;
      if (!campId) return;
      await fetch(`/api/campaigns/${campId}/pause`, { method: 'POST' });
      refreshTelemetry(); loadCampaigns();
    });
  }
  if (btnMonitorResume) {
    btnMonitorResume.addEventListener('click', async () => {
      const campId = btnMonitorResume.dataset.id;
      if (!campId) return;
      await fetch(`/api/campaigns/${campId}/resume`, { method: 'POST' });
      refreshTelemetry(); loadCampaigns();
    });
  }
  if (btnMonitorCancel) {
    btnMonitorCancel.addEventListener('click', async () => {
      const campId = btnMonitorCancel.dataset.id;
      if (!campId) return;
      if (!confirm('Cancel this batch? Remaining queued emails will not be sent.')) return;
      await fetch(`/api/campaigns/${campId}/cancel`, { method: 'POST' });
      refreshTelemetry(); loadCampaigns();
    });
  }

  btnToggleWorker.addEventListener('click', async () => {
    const endpoint = isWorkerPaused ? '/api/worker/resume' : '/api/worker/pause';
    await fetch(endpoint, { method: 'POST' });
    await refreshTelemetry();
  });

  // 3b. IN-FLIGHT QUEUE PIPELINE (Paginated, Filterable & Zero-Flicker)
  let queueCurrentPage = 1;
  let queuePageSize = 25;
  let queueFilterStatus = 'all';
  let isQueueFetching = false;

  const queuePageIndicator = document.getElementById('queuePageIndicator');
  const btnQueuePrevPage = document.getElementById('btnQueuePrevPage');
  const btnQueueNextPage = document.getElementById('btnQueueNextPage');
  const queuePageSizeSelect = document.getElementById('queuePageSizeSelect');

  async function loadQueue() {
    if (!queueTableBody || isQueueFetching) return;
    isQueueFetching = true;

    try {
      const params = new URLSearchParams({
        page: queueCurrentPage,
        limit: queuePageSize,
        status: queueFilterStatus
      });

      const res = await fetch(`/api/queue?${params}`);
      const data = await res.json();

      if (!data.ok || !data.items || data.items.length === 0) {
        if (data.pagination && data.pagination.total > 0 && queueCurrentPage > 1) {
          queueCurrentPage = Math.max(1, data.pagination.totalPages);
          isQueueFetching = false;
          return loadQueue();
        }
        queueTableBody.innerHTML = `<tr><td colspan="9" class="table-empty">Queue is empty. Ready for new campaigns.</td></tr>`;
        if (queuePageIndicator) queuePageIndicator.textContent = 'Page 1 of 1';
        if (btnQueuePrevPage) btnQueuePrevPage.disabled = true;
        if (btnQueueNextPage) btnQueueNextPage.disabled = true;
        return;
      }

      queueTableBody.innerHTML = data.items.map(item => {
        let badgeClass = 'badge-queued';
        if (item.status === 'sending') badgeClass = 'badge-sending';
        else if (item.status === 'sent') badgeClass = 'badge-completed';
        else if (item.status === 'failed') badgeClass = 'badge-failed';

        return `
          <tr>
            <td>#${item.id}</td>
            <td><strong>${escapeHtml(item.email)}</strong></td>
            <td>${escapeHtml(item.name || '--')}</td>
            <td title="${escapeHtml(item.campaign_name || '')}"><strong style="color: var(--sky); font-size: 11px;">${escapeHtml(item.campaign_name ? (item.campaign_name.length > 20 ? item.campaign_name.slice(0, 20) + '...' : item.campaign_name) : '--')}</strong></td>
            <td title="${escapeHtml(item.template_name || '')}"><span style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(item.template_name ? (item.template_name.length > 25 ? item.template_name.slice(0, 25) + '...' : item.template_name) : 'Rotated Template')}</span></td>
            <td><span class="account-badge">${escapeHtml(item.assigned_sender_email || 'Auto-Rotate Pool')}</span></td>
            <td title="${escapeHtml(item.subject)}">${escapeHtml(item.subject ? (item.subject.length > 30 ? item.subject.slice(0, 30) + '...' : item.subject) : '--')}</td>
            <td><span class="badge ${badgeClass}">${item.status.toUpperCase()}</span></td>
            <td>${item.attempts || 0}</td>
          </tr>
        `;
      }).join('');

      // Update Pagination UI
      if (data.pagination) {
        const { page, totalPages, total } = data.pagination;
        if (queuePageIndicator) queuePageIndicator.textContent = `Page ${page} of ${totalPages} (${total} items)`;
        if (btnQueuePrevPage) btnQueuePrevPage.disabled = page <= 1;
        if (btnQueueNextPage) btnQueueNextPage.disabled = page >= totalPages;
      }
    } catch (_) {
    } finally {
      isQueueFetching = false;
    }
  }

  // Queue Pagination & Filter Event Listeners
  document.querySelectorAll('.queue-filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.queue-filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      queueFilterStatus = btn.dataset.status || 'all';
      queueCurrentPage = 1;
      loadQueue();
    });
  });

  if (btnQueuePrevPage) {
    btnQueuePrevPage.addEventListener('click', () => {
      if (queueCurrentPage > 1) {
        queueCurrentPage--;
        loadQueue();
      }
    });
  }

  if (btnQueueNextPage) {
    btnQueueNextPage.addEventListener('click', () => {
      queueCurrentPage++;
      loadQueue();
    });
  }

  if (queuePageSizeSelect) {
    queuePageSizeSelect.addEventListener('change', () => {
      queuePageSize = parseInt(queuePageSizeSelect.value, 10) || 25;
      queueCurrentPage = 1;
      loadQueue();
    });
  }

  const btnRetryFailedQueue = document.getElementById('btnRetryFailedQueue');
  const btnClearCompletedQueue = document.getElementById('btnClearCompletedQueue');

  if (btnRetryFailedQueue) {
    btnRetryFailedQueue.addEventListener('click', async () => {
      btnRetryFailedQueue.disabled = true;
      btnRetryFailedQueue.textContent = '↻ Retrying...';
      try {
        const res = await fetch('/api/queue/retry-failed', { method: 'POST' });
        const data = await res.json();
        alert(data.message || 'Retry initiated');
        refreshTelemetry();
        loadQueue();
      } catch (e) {
        alert('Failed to retry queue: ' + e.message);
      } finally {
        btnRetryFailedQueue.disabled = false;
        refreshTelemetry();
      }
    });
  }

  if (btnClearCompletedQueue) {
    btnClearCompletedQueue.addEventListener('click', async () => {
      if (!confirm('Clear all completed (sent) emails from queue view? Historical audit logs and metrics will remain intact.')) return;
      btnClearCompletedQueue.disabled = true;
      try {
        const res = await fetch('/api/queue/clear-completed', { method: 'POST' });
        const data = await res.json();
        alert(data.message || 'Queue cleaned');
        refreshTelemetry();
        loadQueue();
      } catch (e) {
        alert('Failed to clear queue: ' + e.message);
      } finally {
        btnClearCompletedQueue.disabled = false;
      }
    });
  }

  // 4. LOAD ACCOUNTS POOL
  function resetAccountForm() {
    if (formAddAccount) formAddAccount.reset();
    if (editAccountId) editAccountId.value = '';
    if (accEmailInput) {
      accEmailInput.disabled = false;
      accEmailInput.readOnly = false;
    }
    if (accEmailHelp) accEmailHelp.textContent = 'Must be a Shared Mailbox or User Mailbox in your M365 tenant.';
    if (accountFormTitle) accountFormTitle.textContent = 'Add / Update Sender Account';
    if (btnSubmitAccount) btnSubmitAccount.innerHTML = '➕ Add Account to Pool';
    if (btnCancelEditAccount) btnCancelEditAccount.style.display = 'none';
    if (accDailyLimitInput) accDailyLimitInput.value = 500;
    if (accCooldownInput) accCooldownInput.value = 60;
    updateProviderHelp(accProviderSelect ? accProviderSelect.value : 'GRAPH_API');
  }

  function startEditAccount(accId) {
    const acc = allLoadedAccounts.find(a => String(a.id) === String(accId));
    if (!acc) return;
    switchTab('tab-accounts');
    if (editAccountId) editAccountId.value = acc.id;
    if (accEmailInput) {
      accEmailInput.value = acc.email;
      accEmailInput.disabled = false;
      accEmailInput.readOnly = false;
    }
    if (accEmailHelp) accEmailHelp.textContent = 'Edit email address, display name, daily limit, or speed settings.';
    if (accDisplayNameInput) accDisplayNameInput.value = acc.display_name || '';
    if (accDailyLimitInput) accDailyLimitInput.value = acc.daily_limit;
    if (accCooldownInput) accCooldownInput.value = acc.cooldown_seconds;
    if (accProviderSelect) accProviderSelect.value = acc.provider;
    updateProviderHelp(acc.provider);
    if (accountFormTitle) accountFormTitle.textContent = `✏️ Edit Account: ${acc.email}`;
    if (btnSubmitAccount) btnSubmitAccount.innerHTML = '💾 Save Changes';
    if (btnCancelEditAccount) btnCancelEditAccount.style.display = 'inline-block';
    formAddAccount.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (btnCancelEditAccount) {
    btnCancelEditAccount.addEventListener('click', () => {
      resetAccountForm();
    });
  }

  // 1-Click Pool Quota Presets
  document.querySelectorAll('.btn-quota-preset').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const limit = parseInt(btn.dataset.limit, 10);
      const cooldown = btn.dataset.cooldown !== undefined ? parseInt(btn.dataset.cooldown, 10) : undefined;
      const label = btn.textContent.trim();

      if (!confirm(`Apply quota preset "${label}" (${limit} emails/day) to ALL registered accounts in the pool?`)) {
        return;
      }

      try {
        btn.disabled = true;
        const res = await fetch('/api/settings/bulk-limits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dailyLimit: limit, cooldownSeconds: cooldown })
        });
        const data = await res.json();
        if (data.ok) {
          alert(`✅ Success: ${data.message}`);
          loadAccounts();
          refreshTelemetry();
        } else {
          alert(`❌ Failed: ${data.error}`);
        }
      } catch (err) {
        alert(`Error applying bulk preset: ${err.message}`);
      } finally {
        btn.disabled = false;
      }
    });
  });

  // Reset All Accounts Quotas Buttons
  const attachResetAll = (elemId) => {
    const btn = document.getElementById(elemId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to reset sent today counters to 0 for ALL accounts in the pool?')) return;
      btn.disabled = true;
      try {
        const res = await fetch('/api/accounts/reset-all', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          alert('✅ ' + (data.message || 'All account quotas reset to 0!'));
          loadAccounts();
          refreshTelemetry();
        } else {
          alert('❌ Failed: ' + (data.error || 'Server error'));
        }
      } catch (err) {
        alert('❌ Network error: ' + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  };
  attachResetAll('btnResetAllQuotasOverview');
  attachResetAll('btnResetAllQuotasAccounts');

  async function loadAccounts() {

    try {
      const res = await fetch('/api/accounts');
      const data = await res.json();
      if (!data.ok) return;
      allLoadedAccounts = data.accounts || [];
      badgeAccountCount.textContent = `${allLoadedAccounts.length} accounts`;

      const batchSenderSelect = document.getElementById('batchSenderAccountSelect');
      const quickTestSenderSelect = document.getElementById('quickTestSenderAccount');
      const rerunSenderSelect = document.getElementById('rerunSenderAccountSelect');
      const optionsHtml = allLoadedAccounts.map(a => {
        const engineLabel = a.provider === 'AZURE_ACS' ? '⚡ Azure ACS' : (a.provider === 'OCI' ? '🏛️ Oracle OCI' : '🔷 Graph API');
        return `<option value="${a.id}">[${engineLabel}] ${escapeHtml(a.email)} (${escapeHtml(a.display_name)})</option>`;
      }).join('');

      if (batchSenderSelect) {
        const curVal = batchSenderSelect.value;
        batchSenderSelect.innerHTML = `<option value="">⚡ All Active Accounts Pool (Auto-Rotate)</option>` + optionsHtml;
        if (curVal) batchSenderSelect.value = curVal;
      }
      if (quickTestSenderSelect) {
        const curVal = quickTestSenderSelect.value;
        quickTestSenderSelect.innerHTML = `<option value="">⚡ Next Available Account in Pool</option>` + optionsHtml;
        if (curVal) quickTestSenderSelect.value = curVal;
      }
      if (rerunSenderSelect) {
        const curVal = rerunSenderSelect.value;
        rerunSenderSelect.innerHTML = `<option value="">⚡ Original / Auto-Rotate Pool</option>` + optionsHtml;
        if (curVal) rerunSenderSelect.value = curVal;
      }

      if (allLoadedAccounts.length === 0) {
        accountsTableBody.innerHTML = `<tr><td colspan="6" class="table-empty">No sender accounts registered yet.</td></tr>`;
        accountsPoolGrid.innerHTML = `<div class="loading-placeholder">No accounts registered. Go to "Sender Accounts Pool" tab to add your first account.</div>`;
      } else {
        accountsTableBody.innerHTML = allLoadedAccounts.map((a) => {
          const isLimit = a.sent_today >= a.daily_limit;
          let statusBadge = a.is_active ? '<span class="badge badge-completed">🟢 Active</span>' : '<span class="badge badge-cancelled">⚪ Inactive</span>';
          if (a.is_active && isLimit) {
            statusBadge = '<span class="badge badge-failed">🛑 Limit Reached</span>';
          }
          return `
          <tr>
            <td><strong>${escapeHtml(a.email)}</strong><div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(a.display_name)}</div></td>
            <td><span class="account-badge">${a.provider}</span></td>
            <td><span style="cursor: pointer;" title="Click to toggle status" class="btn-toggle-status" data-id="${a.id}">${statusBadge}</span></td>
            <td><strong style="color: ${isLimit ? 'var(--rose)' : 'inherit'};">${a.sent_today}</strong> / ${a.daily_limit}${isLimit ? ' <span class="badge badge-failed" style="font-size: 10px; margin-left: 4px;">Full</span>' : ''}</td>
            <td>${a.cooldown_seconds}s</td>
            <td>
              <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                <button class="btn btn-primary btn-sm btn-edit-account" data-id="${a.id}" title="Edit daily limit & settings">✏️ Edit</button>
                <button class="btn btn-secondary btn-sm btn-reset-account" data-id="${a.id}" title="Reset sent count to 0">🔄 Reset</button>
                <button class="btn btn-secondary btn-sm btn-toggle-account" data-id="${a.id}">${a.is_active ? 'Disable' : 'Enable'}</button>
                <button class="btn btn-danger btn-sm btn-del-account" data-id="${a.id}">Delete</button>
              </div>
            </td>
          </tr>
        `;
        }).join('');

        document.querySelectorAll('.btn-edit-account').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            startEditAccount(btn.dataset.id);
          });
        });
        document.querySelectorAll('.btn-reset-account').forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Reset today\'s sent counter to 0 for this account?')) return;
            try {
              const res = await fetch(`/api/accounts/${btn.dataset.id}/reset`, { method: 'POST' });
              const data = await res.json();
              if (data.ok) {
                alert('✅ ' + (data.message || 'Account quota reset successfully!'));
                loadAccounts();
                refreshTelemetry();
              } else {
                alert('❌ Failed to reset: ' + (data.error || 'Unknown server error'));
              }
            } catch (err) {
              alert('❌ Network error: ' + err.message);
            }
          });
        });
        document.querySelectorAll('.btn-toggle-account, .btn-toggle-status').forEach((btn) => {
          btn.addEventListener('click', async () => {
            await fetch(`/api/accounts/${btn.dataset.id}/toggle`, { method: 'PATCH' });
            loadAccounts(); refreshTelemetry();
          });
        });
        document.querySelectorAll('.btn-del-account').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!confirm('Remove this sender account from pool?')) return;
            await fetch(`/api/accounts/${btn.dataset.id}`, { method: 'DELETE' });
            loadAccounts(); refreshTelemetry();
          });
        });

        accountsPoolGrid.innerHTML = allLoadedAccounts.map((a) => {
          const isCooldown = a.cooldown_remaining_sec > 0;
          const remaining = a.remaining_today !== undefined ? a.remaining_today : Math.max(0, a.daily_limit - a.sent_today);
          const isLimitReached = remaining <= 0;
          const serviceName = a.provider === 'AZURE_ACS' ? 'Azure Email' : (a.provider === 'OCI' ? 'Oracle Email' : 'Microsoft 365');
          const healthScore = a.computed_health_score || a.health_score || 100;
          const healthLabel = healthScore >= 90 ? 'Healthy' : (healthScore >= 70 ? 'Good' : 'Needs Review');
          
          const humanStatus = isLimitReached 
            ? 'Daily Limit Reached' 
            : (a.human_status || (isCooldown ? 'Temporarily paused' : (a.is_active ? 'Ready' : 'Disabled')));
          const statusColor = isLimitReached 
            ? 'var(--rose)' 
            : (a.status_color === 'rose' ? 'var(--rose)' : (a.status_color === 'amber' || isCooldown ? 'var(--amber)' : (a.is_active ? 'var(--emerald)' : 'var(--text-muted)')));
          const statusDot = isLimitReached 
            ? '🛑' 
            : (a.status_color === 'rose' ? '✕' : (isCooldown ? '⏸' : (a.is_active ? '●' : '○')));

          const remPct = a.daily_limit > 0 ? Math.min(100, Math.round((remaining / a.daily_limit) * 100)) : 0;
          const barWidth = isLimitReached ? 100 : remPct;
          const barColor = isLimitReached ? 'var(--rose)' : (remPct <= 15 ? 'var(--amber)' : 'var(--emerald)');
          const barGlow = isLimitReached ? 'box-shadow: 0 0 10px rgba(244, 63, 94, 0.45);' : '';

          return `
            <div class="account-card" style="border-radius: 10px; padding: 14px; background: var(--bg-card); border: 1px solid ${isLimitReached ? 'rgba(244, 63, 94, 0.4)' : 'var(--border-color)'}; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="color: ${statusColor}; font-weight: 700; font-size: 13px;">${statusDot}</span>
                    <span style="font-weight: 700; font-size: 12px; color: ${statusColor};">${humanStatus}</span>
                  </div>
                  <span class="account-badge" style="font-size: 10px; font-weight: 600;">${serviceName}</span>
                </div>

                <div style="margin-bottom: 10px;">
                  <div style="font-weight: 700; font-size: 13px; color: var(--text-primary);">${escapeHtml(a.display_name || a.email.split('@')[0])}</div>
                  <div style="font-size: 11px; color: var(--sky); font-family: var(--font-mono);">${escapeHtml(a.email)}</div>
                </div>

                <!-- Account Health -->
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; margin-bottom: 4px;">
                  <span style="color: var(--text-muted);">Account Health</span>
                  <span style="font-weight: 600; color: ${healthScore >= 80 ? 'var(--emerald)' : 'var(--amber)'};">${healthLabel} (${healthScore}/100)</span>
                </div>
                <div class="gauge-bar-bg" style="height: 4px; margin-bottom: 10px;">
                  <div class="gauge-bar-fill" style="width: ${healthScore}%; background-color: ${healthScore >= 80 ? 'var(--emerald)' : 'var(--amber)'};"></div>
                </div>

                <!-- Daily Sending Limit & Available Today -->
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; margin-bottom: 4px;">
                  <span style="color: var(--text-muted);">Available Today</span>
                  <strong style="color: ${isLimitReached ? 'var(--rose)' : 'var(--text-primary)'};">${remaining.toLocaleString()} / ${a.daily_limit.toLocaleString()}${isLimitReached ? ' (0 Left)' : ''}</strong>
                </div>
                <div class="gauge-bar-bg" style="height: 6px; margin-bottom: 8px;">
                  <div class="gauge-bar-fill" style="width: ${barWidth}%; background-color: ${barColor}; ${barGlow}"></div>
                </div>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 11px;">
                <span style="color: ${isCooldown ? 'var(--amber)' : (isLimitReached ? 'var(--rose)' : 'var(--text-muted)')}; font-weight: ${isLimitReached ? '600' : 'normal'};">
                  ${isCooldown ? `⏳ Resumes in ${a.cooldown_remaining_sec}s` : (isLimitReached ? '🛑 Daily quota full' : `Speed: ${a.sending_speed || 'Balanced'}`)}
                </span>
                <div style="display: flex; gap: 4px;">
                  <button class="btn btn-secondary btn-xs btn-reset-card" data-id="${a.id}" style="padding: 3px 6px; font-size: 11px;" title="Reset sent today to 0">🔄 Reset</button>
                  <button class="btn btn-secondary btn-xs btn-edit-account-card" data-id="${a.id}" style="padding: 3px 8px; font-size: 11px;">Manage</button>
                </div>
              </div>
            </div>
          `;
        }).join('');

        document.querySelectorAll('.btn-edit-account-card').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            startEditAccount(btn.dataset.id);
          });
        });

        document.querySelectorAll('.btn-reset-card').forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Reset today\'s sent counter to 0 for this account?')) return;
            try {
              const res = await fetch(`/api/accounts/${btn.dataset.id}/reset`, { method: 'POST' });
              const data = await res.json();
              if (data.ok) {
                alert('✅ ' + (data.message || 'Account quota reset successfully!'));
                loadAccounts();
                refreshTelemetry();
              } else {
                alert('❌ Failed to reset: ' + (data.error || 'Unknown server error'));
              }
            } catch (err) {
              alert('❌ Network error: ' + err.message);
            }
          });
        });
      }
    } catch (err) { console.error('Error loading accounts:', err); }
  }

  // Bind Bulk Reset Quotas
  const handleResetAllQuotas = async () => {
    if (!confirm('Reset sent counters to 0 for ALL accounts in the pool?')) return;
    try {
      const res = await fetch('/api/accounts/reset-all', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        alert('✅ All account quotas have been reset to 0!');
        loadAccounts();
        refreshTelemetry();
      } else {
        alert(data.error || 'Failed to reset quotas');
      }
    } catch (err) {
      alert('Error resetting quotas: ' + err.message);
    }
  };

  const btnResetAllOverview = document.getElementById('btnResetAllQuotasOverview');
  if (btnResetAllOverview) btnResetAllOverview.addEventListener('click', handleResetAllQuotas);
  const btnResetAllAccounts = document.getElementById('btnResetAllQuotasAccounts');
  if (btnResetAllAccounts) btnResetAllAccounts.addEventListener('click', handleResetAllQuotas);
  const btnGoToAccounts = document.getElementById('btnGoToAccountsTab');
  if (btnGoToAccounts) btnGoToAccounts.addEventListener('click', () => switchTab('tab-accounts'));

  formAddAccount.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = editAccountId ? editAccountId.value : '';
    const dailyLimit = parseInt(accDailyLimitInput.value, 10);
    const cooldownSeconds = parseInt(accCooldownInput.value, 10);

    if (isNaN(dailyLimit) || dailyLimit < 1) {
      return alert('Please enter a valid daily limit (minimum 1)');
    }

    if (id) {
      const payload = {
        email: accEmailInput.value.trim(),
        displayName: accDisplayNameInput.value.trim(),
        dailyLimit,
        cooldownSeconds: isNaN(cooldownSeconds) ? 0 : cooldownSeconds,
        provider: accProviderSelect.value
      };
      const res = await fetch(`/api/accounts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.ok) {
        alert(`✅ Account "${payload.email || 'Sender'}" updated successfully!`);
        resetAccountForm();
        loadAccounts();
        refreshTelemetry();
      } else {
        alert(data.error || 'Failed to update account');
      }
    } else {
      const payload = {
        email: accEmailInput.value.trim(),
        displayName: accDisplayNameInput.value.trim(),
        dailyLimit,
        cooldownSeconds: isNaN(cooldownSeconds) ? 0 : cooldownSeconds,
        provider: accProviderSelect.value
      };
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.ok) {
        resetAccountForm();
        loadAccounts();
        refreshTelemetry();
      } else {
        alert(data.error || 'Failed to add account');
      }
    }
  });

  // 5. TEMPLATES
  async function loadTemplates() {
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      if (!data.ok) return;
      allLoadedTemplates = data.templates || [];
      const tplOptions = `<option value="">-- Choose Template --</option>` + allLoadedTemplates.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');

      const batchTplSelect = document.getElementById('batchTemplateSelect');
      if (batchTplSelect) batchTplSelect.innerHTML = tplOptions;

      const templateCheckboxesList = document.getElementById('templateCheckboxesList');
      if (templateCheckboxesList) {
        templateCheckboxesList.innerHTML = allLoadedTemplates.map((t, idx) => `
          <label style="display: flex; align-items: center; gap: 8px; background: var(--bg-surface); padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); cursor: pointer; font-size: 12px;">
            <input type="checkbox" class="chk-rotate-tpl" value="${t.id}" ${idx < 2 ? 'checked' : ''}>
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;">${escapeHtml(t.name)}</span>
          </label>
        `).join('');

        document.querySelectorAll('.chk-rotate-tpl').forEach(cb => {
          cb.addEventListener('change', updateSampleEmailPreview);
        });
      }

      if (allLoadedTemplates.length === 0) {
        templatesList.innerHTML = `<div class="loading-placeholder">No templates saved yet.</div>`;
      } else {
        templatesList.innerHTML = allLoadedTemplates.map((t) => `
          <div class="panel-card" style="margin-bottom: 12px; background: var(--bg-card);">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <strong>${escapeHtml(t.name)}</strong>
              <div style="display: flex; gap: 6px;">
                <button class="btn btn-secondary btn-sm btn-edit-tpl" data-tpl='${JSON.stringify(t)}'>Edit</button>
                <button class="btn btn-secondary btn-sm btn-delete-tpl" data-id="${t.id}" style="color: var(--rose);">Delete</button>
              </div>
            </div>
            <div style="font-size: 12px; color: var(--sky); margin: 6px 0;">Subject: ${escapeHtml(t.subject)}</div>
          </div>
        `).join('');

        document.querySelectorAll('.btn-edit-tpl').forEach((btn) => {
          btn.addEventListener('click', () => {
            const t = JSON.parse(btn.dataset.tpl);
            tplId.value = t.id; tplName.value = t.name; tplSubject.value = t.subject; tplBody.value = t.body_html;
            window.scrollTo({ top: 0, behavior: 'smooth' });
          });
        });
        document.querySelectorAll('.btn-delete-tpl').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to delete this email template?')) return;
            const res = await fetch(`/api/templates/${btn.dataset.id}`, { method: 'DELETE' });
            const result = await res.json();
            if (result.ok) loadTemplates(); else alert(result.error || 'Failed to delete template');
          });
        });
      }
    } catch (_) { }
  }

    formTemplate.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = { id: tplId.value || null, name: tplName.value.trim(), subject: tplSubject.value.trim(), bodyHtml: tplBody.value.trim() };
    const res = await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (data.ok) { formTemplate.reset(); tplId.value = ''; loadTemplates(); alert('Template saved successfully!'); }
    else { alert(data.error || 'Failed to save template'); }
  });
  btnResetTemplate.addEventListener('click', () => { formTemplate.reset(); tplId.value = ''; });

  // Quick Preset Link Buttons
  document.querySelectorAll('.btn-preset-link').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      const text = btn.dataset.text;
      const htmlSnippet = `<a href="${url}">${text}</a>`;
      insertTextAtCursor(tplBody, htmlSnippet);
    });
  });

  // Modal Dynamic Link Builder
  const btnOpenLinkBuilder = document.getElementById('btnOpenLinkBuilder');
  const modalLinkBuilder = document.getElementById('modalLinkBuilder');
  const btnCloseLinkBuilder = document.getElementById('btnCloseLinkBuilder');
  const btnCancelLinkBuilder = document.getElementById('btnCancelLinkBuilder');
  const formLinkBuilder = document.getElementById('formLinkBuilder');
  const linkBuilderText = document.getElementById('linkBuilderText');
  const linkBuilderPath = document.getElementById('linkBuilderPath');
  const linkBuilderPreviewCode = document.getElementById('linkBuilderPreviewCode');

  function updateLinkBuilderPreview() {
    const text = linkBuilderText.value.trim() || 'Link Text';
    let path = linkBuilderPath.value.trim() || '/';
    if (!path.startsWith('/')) path = '/' + path;
    const generatedHtml = `<a href="https://{{senderDomain}}${path}">${text}</a>`;
    if (linkBuilderPreviewCode) linkBuilderPreviewCode.textContent = generatedHtml;
    return generatedHtml;
  }

  function insertTextAtCursor(textarea, text) {
    if (!textarea) return;
    const start = textarea.selectionStart || textarea.value.length;
    const end = textarea.selectionEnd || textarea.value.length;
    textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(end);
    textarea.focus();
    textarea.setSelectionRange(start + text.length, start + text.length);
  }

  if (btnOpenLinkBuilder) {
    btnOpenLinkBuilder.addEventListener('click', () => {
      modalLinkBuilder.style.display = 'flex';
      if (!linkBuilderText.value) linkBuilderText.value = 'Submit Your Manuscript';
      if (!linkBuilderPath.value) linkBuilderPath.value = '/submit-manuscript';
      updateLinkBuilderPreview();
      linkBuilderText.focus();
    });
  }

  if (btnCloseLinkBuilder) btnCloseLinkBuilder.addEventListener('click', () => modalLinkBuilder.style.display = 'none');
  if (btnCancelLinkBuilder) btnCancelLinkBuilder.addEventListener('click', () => modalLinkBuilder.style.display = 'none');

  if (linkBuilderText) linkBuilderText.addEventListener('input', updateLinkBuilderPreview);
  if (linkBuilderPath) linkBuilderPath.addEventListener('input', updateLinkBuilderPreview);

  document.querySelectorAll('.btn-add-param').forEach(btn => {
    btn.addEventListener('click', () => {
      const param = btn.dataset.param;
      const cur = linkBuilderPath.value.trim();
      const separator = cur.includes('?') ? '&' : '?';
      linkBuilderPath.value = cur + separator + param;
      updateLinkBuilderPreview();
    });
  });

  if (formLinkBuilder) {
    formLinkBuilder.addEventListener('submit', (e) => {
      e.preventDefault();
      const snippet = updateLinkBuilderPreview();
      insertTextAtCursor(tplBody, snippet);
      modalLinkBuilder.style.display = 'none';
    });
  }

  // 6. CSV CONTACT UPLOAD
  dropZone.addEventListener('click', () => csvFileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFileSelected(e.dataTransfer.files[0]);
  });
  csvFileInput.addEventListener('change', () => { if (csvFileInput.files.length > 0) handleFileSelected(csvFileInput.files[0]); });

  function handleFileSelected(file) {
    const isSupported = /\.(csv|xlsx|xls)$/i.test(file.name);
    if (!isSupported) { alert('Please select a valid Excel (.xlsx, .xls) or CSV (.csv) spreadsheet file'); return; }
    selectedFile = file;
    selectedFileName.textContent = `Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`;
    btnUploadCsv.disabled = false;
  }

  formUploadCsv.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedFile) return;
    btnUploadCsv.disabled = true; btnUploadCsv.textContent = '⏳ Parsing & Importing...';
    const formData = new FormData(); formData.append('file', selectedFile);
    try {
      const res = await fetch('/api/contacts/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.ok) {
        alert(`Successfully imported ${data.imported} contacts! (${data.skipped} skipped/invalid)`);
        selectedFile = null; selectedFileName.textContent = ''; btnUploadCsv.textContent = '📥 Parse & Save Contacts';
        loadContacts();
      } else { alert(data.error || 'Failed to upload CSV'); btnUploadCsv.disabled = false; btnUploadCsv.textContent = '📥 Parse & Save Contacts'; }
    } catch (err) { alert('Error uploading file: ' + err.message); btnUploadCsv.disabled = false; btnUploadCsv.textContent = '📥 Parse & Save Contacts'; }
  });

  async function loadContacts() {
    try {
      const res = await fetch('/api/contacts?limit=100');
      const data = await res.json();
      if (!data.ok) return;
      statTotalContacts.textContent = data.total;
      badgeContactTotal.textContent = `${data.total} contacts in directory`;
      if (data.contacts.length === 0) {
        contactsTableBody.innerHTML = `<tr><td colspan="4" class="table-empty">No contacts in directory. Drag &amp; drop a CSV file to import.</td></tr>`;
      } else {
        contactsTableBody.innerHTML = data.contacts.map((c) => `
          <tr><td><strong>${escapeHtml(c.email)}</strong></td><td>${escapeHtml(c.name || '--')}</td><td>${escapeHtml(c.paper_title || '--')}</td><td><span class="badge badge-completed">${c.status}</span></td></tr>
        `).join('');
      }
    } catch (_) { }
  }

  // 7. AUTO-SPLIT CSV CAMPAIGN WIZARD
  const campaignDropZone = document.getElementById('campaignDropZone');
  const campaignCsvFileInput = document.getElementById('campaignCsvFileInput');
  const campaignPreviewLoading = document.getElementById('campaignPreviewLoading');
  const campaignPreFlightBox = document.getElementById('campaignPreFlightBox');
  const btnCancelPreview = document.getElementById('btnCancelPreview');
  const batchBaseCampaignName = document.getElementById('batchBaseCampaignName');
  const batchSizeInput = document.getElementById('batchSizeInput');
  const batchTemplateSelect = document.getElementById('batchTemplateSelect');
  const chkSkipPreviouslyContacted = document.getElementById('chkSkipPreviouslyContacted');
  const batchesListContainer = document.getElementById('batchesListContainer');
  const sampleRecipientEmail = document.getElementById('sampleRecipientEmail');
  const sampleSubjectLine = document.getElementById('sampleSubjectLine');
  const sampleEmailBody = document.getElementById('sampleEmailBody');
  const formLaunchBatches = document.getElementById('formLaunchBatches');
  const btnConfirmLaunchBatches = document.getElementById('btnConfirmLaunchBatches');
  const prevTotalRows = document.getElementById('prevTotalRows');
  const prevValidCount = document.getElementById('prevValidCount');
  const prevDuplicateCount = document.getElementById('prevDuplicateCount');
  const prevInvalidCount = document.getElementById('prevInvalidCount');
  const prevContactedCount = document.getElementById('prevContactedCount');

  if (campaignDropZone && campaignCsvFileInput) {
    campaignDropZone.addEventListener('click', () => campaignCsvFileInput.click());
    campaignDropZone.addEventListener('dragover', (e) => { e.preventDefault(); campaignDropZone.classList.add('dragover'); });
    campaignDropZone.addEventListener('dragleave', () => campaignDropZone.classList.remove('dragover'));
    campaignDropZone.addEventListener('drop', (e) => {
      e.preventDefault(); campaignDropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleCampaignFileSelected(e.dataTransfer.files[0]);
    });
    campaignCsvFileInput.addEventListener('change', () => { if (campaignCsvFileInput.files.length > 0) handleCampaignFileSelected(campaignCsvFileInput.files[0]); });
  }
  if (btnCancelPreview) {
    btnCancelPreview.addEventListener('click', () => {
      currentPreviewData = null; campaignPreFlightBox.style.display = 'none'; campaignDropZone.style.display = 'block';
      if (campaignCsvFileInput) campaignCsvFileInput.value = '';
    });
  }

  async function handleCampaignFileSelected(file) {
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) { alert('Please upload a valid CSV or spreadsheet file (.csv, .xlsx, .xls)'); return; }
    campaignPreviewLoading.style.display = 'block'; campaignPreFlightBox.style.display = 'none';
    const formData = new FormData(); formData.append('file', file); formData.append('batchSize', batchSizeInput ? batchSizeInput.value || 50 : 50);
    try {
      const res = await fetch('/api/campaigns/preview-upload', { method: 'POST', body: formData });
      const data = await res.json();
      campaignPreviewLoading.style.display = 'none';
      if (!data.ok) { alert(data.error || 'Failed to parse file for preview.'); return; }
      currentPreviewData = data; renderPreFlightPreview();
    } catch (err) { campaignPreviewLoading.style.display = 'none'; alert('Error analyzing CSV preview: ' + err.message); }
  }

  function renderPreFlightPreview() {
    if (!currentPreviewData) return;
    prevTotalRows.textContent = currentPreviewData.totalRows;
    prevValidCount.textContent = currentPreviewData.validCount;
    prevDuplicateCount.textContent = currentPreviewData.duplicateInSheetCount;
    prevInvalidCount.textContent = currentPreviewData.invalidCount;
    prevContactedCount.textContent = currentPreviewData.previouslyContactedCount;
    batchBaseCampaignName.value = currentPreviewData.baseCampaignName;
    batchSizeInput.value = currentPreviewData.batchSize || 50;
    campaignPreFlightBox.style.display = 'block';
    renderBatchesBreakdown(); updateSampleEmailPreview();
  }

  function renderBatchesBreakdown() {
    if (!currentPreviewData) return;
    const size = Math.max(1, parseInt(batchSizeInput.value || '50', 10));
    const skip = chkSkipPreviouslyContacted.checked;
    let contacts = currentPreviewData.contacts;
    if (skip) contacts = contacts.filter((c) => !c.previouslyContacted);
    const totalBatches = Math.ceil(contacts.length / size) || 1;
    const baseName = batchBaseCampaignName.value.trim() || currentPreviewData.baseCampaignName;
    const mode = campaignScheduleMode ? campaignScheduleMode.value : 'immediate';
    const startTimeVal = campaignScheduledStartTime ? campaignScheduledStartTime.value : '';
    const staggerMins = Math.max(1, parseInt(campaignStaggerMinutes ? campaignStaggerMinutes.value || '60' : '60', 10));
    let baseMs = Date.now();
    if (startTimeVal && (mode === 'scheduled' || mode === 'staggered')) {
      const parsed = new Date(startTimeVal).getTime();
      if (!isNaN(parsed) && parsed > Date.now()) baseMs = parsed;
    }
    batchesListContainer.innerHTML = '';
    for (let i = 0; i < totalBatches; i++) {
      const start = i * size;
      const count = Math.min(size, contacts.length - start);
      const batchNumStr = String(i + 1).padStart(2, '0');
      const batchName = `${baseName}_Batch_${batchNumStr}`;
      let startMs = baseMs;
      if (mode === 'staggered') startMs = baseMs + i * (staggerMins * 60 * 1000);
      else if (mode === 'scheduled') startMs = baseMs + i * 2000;
      else startMs = Date.now() + i * 2000;
      const durationSec = Math.round(count * 2.5);
      const durationStr = durationSec < 60 ? `${durationSec}s` : `${Math.ceil(durationSec / 60)} min`;
      const timeStr = new Date(startMs).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const timeBadge = mode === 'immediate' && i === 0 ? '⚡ Starts Now' : formatTimeUntil(new Date(startMs).toISOString());
      batchesListContainer.innerHTML += `
        <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; font-size: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
            <strong style="color: var(--sky);">${escapeHtml(batchName)}</strong>
            <span class="badge ${mode === 'immediate' && i === 0 ? 'badge-completed' : 'badge-scheduled'}">${timeBadge}</span>
          </div>
          <div style="color: var(--text-muted); margin-bottom: 4px;">👥 <strong>${count}</strong> emails &bull; Est: ~${durationStr}</div>
          <div style="font-size: 11px; color: var(--text-secondary);">📅 Scheduled: <strong>${timeStr}</strong></div>
        </div>
      `;
    }
    btnConfirmLaunchBatches.textContent = `🚀 Confirm & Schedule All ${totalBatches} Batches (${contacts.length} Total Emails)`;
  }

  const chkEnableTemplateRotation = document.getElementById('chkEnableTemplateRotation');
  const singleTemplateContainer = document.getElementById('singleTemplateContainer');
  const multiTemplateContainer = document.getElementById('multiTemplateContainer');

  if (chkEnableTemplateRotation) {
    chkEnableTemplateRotation.addEventListener('change', () => {
      const isRotation = chkEnableTemplateRotation.checked;
      if (singleTemplateContainer) singleTemplateContainer.style.display = isRotation ? 'none' : 'block';
      if (multiTemplateContainer) multiTemplateContainer.style.display = isRotation ? 'block' : 'none';
      updateSampleEmailPreview();
    });
  }

  let previewContactIndex = 0;

  function updateSampleEmailPreview() {
    if (!currentPreviewData || !currentPreviewData.contacts.length) return;
    const isRotation = chkEnableTemplateRotation && chkEnableTemplateRotation.checked;
    const checkedBoxes = Array.from(document.querySelectorAll('.chk-rotate-tpl:checked'));
    
    let activeTemplatesList = [];
    if (isRotation && checkedBoxes.length > 0) {
      activeTemplatesList = checkedBoxes.map(cb => allLoadedTemplates.find(t => String(t.id) === String(cb.value))).filter(Boolean);
    } else if (batchTemplateSelect && batchTemplateSelect.value) {
      const singleTpl = allLoadedTemplates.find(t => String(t.id) === String(batchTemplateSelect.value));
      if (singleTpl) activeTemplatesList = [singleTpl];
    }

    if (previewContactIndex >= currentPreviewData.contacts.length) previewContactIndex = 0;
    const currentContact = currentPreviewData.contacts[previewContactIndex];

    let assignedTemplate = null;
    if (activeTemplatesList.length > 0) {
      const rotationStrategy = document.querySelector('input[name="templateRotationStrategy"]:checked')?.value || 'PER_EMAIL';
      const batchSize = Math.max(1, parseInt(batchSizeInput?.value || '50', 10));
      const tplIndex = rotationStrategy === 'PER_EMAIL'
        ? previewContactIndex % activeTemplatesList.length
        : Math.floor(previewContactIndex / batchSize) % activeTemplatesList.length;
      assignedTemplate = activeTemplatesList[tplIndex];
    }

    // Recipient Navigation Bar in Preview
    const navHtml = currentPreviewData.contacts.length > 1 ? `
      <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 8px;">
        <button type="button" class="btn btn-secondary btn-sm" id="btnPrevSampleContact" style="padding: 2px 8px; font-size: 11px;" ${previewContactIndex === 0 ? 'disabled' : ''}>◀ Prev</button>
        <span style="font-size: 11px; font-weight: 600; color: var(--text-primary);">Recipient ${previewContactIndex + 1} of ${currentPreviewData.contacts.length}</span>
        <button type="button" class="btn btn-secondary btn-sm" id="btnNextSampleContact" style="padding: 2px 8px; font-size: 11px;" ${previewContactIndex >= currentPreviewData.contacts.length - 1 ? 'disabled' : ''}>Next ▶</button>
        ${assignedTemplate ? `<span class="badge badge-scheduled" style="font-size: 10px; margin-left: 6px;">Variant: ${escapeHtml(assignedTemplate.name)}</span>` : ''}
      </div>
    ` : '';

    sampleRecipientEmail.innerHTML = navHtml + `<span>Recipient: <strong>${escapeHtml(currentContact.email)}</strong> (${escapeHtml(currentContact.name || 'Author')})</span>`;
    
    // Attach buttons for stepping through sample contacts
    document.getElementById('btnPrevSampleContact')?.addEventListener('click', () => {
      if (previewContactIndex > 0) { previewContactIndex--; updateSampleEmailPreview(); }
    });
    document.getElementById('btnNextSampleContact')?.addEventListener('click', () => {
      if (previewContactIndex < currentPreviewData.contacts.length - 1) { previewContactIndex++; updateSampleEmailPreview(); }
    });

    if (!assignedTemplate) {
      sampleSubjectLine.textContent = isRotation ? 'Subject: (Select at least 2 templates above to rotate)' : 'Subject: (Choose a template above)';
      sampleEmailBody.innerHTML = 'Choose or check template(s) above to preview how the email will look with merged variables.';
      return;
    }

    function merge(str, c) {
      const activeSender = document.getElementById('batchSenderAccountSelect')?.selectedOptions[0]?.text || 'dr.reetashah@theparipexjournal.com';
      let rawDomain = activeSender.includes('@') ? activeSender.split('@')[1].replace(/[^a-zA-Z0-9.-]/g, '') : 'theparipexjournal.com';
      
      // Extract apex domain
      const parts = rawDomain.split('.');
      let senderDomain = rawDomain;
      const twoPartTlds = ['co.uk', 'co.in', 'org.uk', 'gov.in', 'net.in', 'ac.in', 'edu.in', 'com.au', 'com.br'];
      const lastTwo = parts.slice(-2).join('.');
      if (twoPartTlds.includes(lastTwo) && parts.length >= 3) {
        senderDomain = parts.slice(-3).join('.');
      } else if (parts.length > 2) {
        senderDomain = parts.slice(-2).join('.');
      }

      let out = (str || '')
        .replace(/\{\{\s*Name\s*\}\}/gi, c.name || 'Dr. Researcher')
        .replace(/\{\{\s*Paper\s*Title\s*\}\}/gi, c.paper_title || 'Recent Scientific Advances')
        .replace(/\{\{\s*Affiliation\s*\}\}/gi, c.affiliation || 'University Department')
        .replace(/\{\{\s*senderDomain\s*\}\}/gi, senderDomain)
        .replace(/\{\{\s*sender_domain\s*\}\}/gi, senderDomain)
        .replace(/\{\{\s*senderEmail\s*\}\}/gi, activeSender)
        .replace(/\{\{\s*sender_email\s*\}\}/gi, activeSender)
        .replace(/\{\{\s*Date\s*\}\}/gi, new Date().toLocaleDateString());

      // Safe anchor-only link rewriting in preview
      out = out.replace(/<a\b([^>]*?)\bhref=["'](\/(?!\/)[^"']*)["']([^>]*)>/gi, (match, prefix, path, suffix) => {
        return `<a${prefix}href="https://${senderDomain}${path}"${suffix}>`;
      });
      return out;
    }

    const rotationInfo = isRotation ? ` [Rotating: ${activeTemplatesList.length} Templates Active]` : '';
    sampleSubjectLine.innerHTML = `<span style="color: var(--text-muted); font-size: 11px;">Subject:</span> <b>${escapeHtml(merge(assignedTemplate.subject, currentContact))}</b>${rotationInfo}`;
    
    const rawHtml = merge(assignedTemplate.body_html, currentContact);
    if (typeof DOMPurify !== 'undefined') {
      sampleEmailBody.innerHTML = DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
    } else {
      sampleEmailBody.innerHTML = rawHtml;
    }
  }

  if (batchSizeInput) batchSizeInput.addEventListener('input', renderBatchesBreakdown);
  if (batchBaseCampaignName) batchBaseCampaignName.addEventListener('input', renderBatchesBreakdown);
  if (chkSkipPreviouslyContacted) chkSkipPreviouslyContacted.addEventListener('change', renderBatchesBreakdown);
  if (batchTemplateSelect) batchTemplateSelect.addEventListener('change', updateSampleEmailPreview);

  if (campaignScheduleMode) {
    campaignScheduleMode.addEventListener('change', () => {
      const mode = campaignScheduleMode.value;
      if (mode === 'scheduled') {
        groupScheduledStartTime.style.display = 'block'; groupStaggerInterval.style.display = 'none';
        if (!campaignScheduledStartTime.value) { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0); campaignScheduledStartTime.value = tomorrow.toISOString().slice(0, 16); }
      } else if (mode === 'staggered') {
        groupScheduledStartTime.style.display = 'block'; groupStaggerInterval.style.display = 'block';
        if (!campaignScheduledStartTime.value) { const now = new Date(); campaignScheduledStartTime.value = now.toISOString().slice(0, 16); }
      } else {
        groupScheduledStartTime.style.display = 'none'; groupStaggerInterval.style.display = 'none';
      }
      renderBatchesBreakdown();
    });
  }
  if (campaignScheduledStartTime) campaignScheduledStartTime.addEventListener('input', renderBatchesBreakdown);
  if (campaignStaggerMinutes) campaignStaggerMinutes.addEventListener('input', renderBatchesBreakdown);

  // Strategy & Speed Presets UX bindings
  const strategyRadios = document.querySelectorAll('input[name="sendingStrategyRadio"]');
  const controlledOptions = document.getElementById('controlledStrategyOptions');
  const speedPresetRadios = document.querySelectorAll('input[name="sendingSpeedPreset"]');
  const customIntervalBox = document.getElementById('customIntervalBox');
  const inputCustomIntervalSec = document.getElementById('inputCustomIntervalSec');

  strategyRadios.forEach(r => {
    r.addEventListener('change', () => {
      if (controlledOptions) {
        controlledOptions.style.display = r.value === 'CONTROLLED' ? 'block' : 'none';
      }
    });
  });

  speedPresetRadios.forEach(r => {
    r.addEventListener('change', () => {
      if (customIntervalBox) {
        customIntervalBox.style.display = r.value === 'CUSTOM' ? 'flex' : 'none';
      }
    });
  });

  if (formLaunchBatches) {
    const handleLaunchSubmit = async (e) => {
      if (e) e.preventDefault();
      if (!currentPreviewData) {
        alert('⚠️ No CSV preview data loaded. Please re-upload your CSV file first.');
        return;
      }

      const campaignNameVal = (batchBaseCampaignName ? batchBaseCampaignName.value.trim() : '') || currentPreviewData.baseCampaignName;
      if (!campaignNameVal) {
        alert('⚠️ Please enter a Campaign Name.');
        if (batchBaseCampaignName) batchBaseCampaignName.focus();
        return;
      }

      const isRotation = chkEnableTemplateRotation && chkEnableTemplateRotation.checked;
      let templateId = null;
      let templateIds = [];

      if (isRotation) {
        const checkedBoxes = Array.from(document.querySelectorAll('.chk-rotate-tpl:checked'));
        if (checkedBoxes.length < 2) {
          alert('⚠️ Please select at least 2 templates to enable Template Rotation, or uncheck the rotation option.');
          return;
        }
        templateIds = checkedBoxes.map(b => parseInt(b.value, 10));
        templateId = templateIds[0];
      } else {
        templateId = batchTemplateSelect && batchTemplateSelect.value ? parseInt(batchTemplateSelect.value, 10) : null;
        if (!templateId) {
          alert('⚠️ Please select an Email Template from the dropdown before confirming.');
          if (batchTemplateSelect) batchTemplateSelect.focus();
          return;
        }
      }

      btnConfirmLaunchBatches.disabled = true;
      btnConfirmLaunchBatches.textContent = '⏳ Creating Campaigns & Scheduling Queue...';
      
      const senderAccountIdVal = document.getElementById('batchSenderAccountSelect')?.value;
      const selectedStrategy = document.querySelector('input[name="sendingStrategyRadio"]:checked')?.value || 'SMART';
      const fallbackAllowed = document.getElementById('chkFallbackAllowed') ? document.getElementById('chkFallbackAllowed').checked : true;
      const selectedSpeedPreset = document.querySelector('input[name="sendingSpeedPreset"]:checked')?.value || 'BALANCED';
      const templateRotationStrategy = document.querySelector('input[name="templateRotationStrategy"]:checked')?.value || 'PER_EMAIL';
      
      let customMs = 2500;
      if (selectedSpeedPreset === 'SAFE') customMs = 6500;
      else if (selectedSpeedPreset === 'BALANCED') customMs = 2500;
      else if (selectedSpeedPreset === 'FAST') customMs = 1000;
      else if (selectedSpeedPreset === 'CUSTOM' && inputCustomIntervalSec) {
        customMs = Math.round(parseFloat(inputCustomIntervalSec.value || '2.5') * 1000);
      }

      // Resolve sender: only use explicit account ID when Controlled + a real account is picked
      const parsedSenderId = (selectedStrategy === 'CONTROLLED' && senderAccountIdVal) ? parseInt(senderAccountIdVal, 10) : null;

      const payload = {
        baseCampaignName: batchBaseCampaignName.value.trim() || currentPreviewData.baseCampaignName,
        templateId: templateId,
        templateIds: templateIds,
        templateRotationStrategy: templateRotationStrategy,
        batchSize: parseInt(batchSizeInput.value || '50', 10),
        skipPreviouslyContacted: chkSkipPreviouslyContacted.checked,
        scheduleMode: campaignScheduleMode ? campaignScheduleMode.value : 'immediate',
        scheduledStartTime: (campaignScheduledStartTime && campaignScheduledStartTime.value) ? new Date(campaignScheduledStartTime.value).toISOString() : '',
        staggerMinutes: parseInt(campaignStaggerMinutes ? campaignStaggerMinutes.value || '60' : '60', 10),
        contacts: currentPreviewData.contacts,
        senderAccountId: (!isNaN(parsedSenderId) && parsedSenderId) ? parsedSenderId : null,
        mode: selectedStrategy,
        fallbackAllowed: fallbackAllowed,
        sendingSpeed: selectedSpeedPreset,
        customIntervalMs: customMs
      };

      console.log('[Launch] Submitting campaign payload:', JSON.stringify({ ...payload, contacts: `[${payload.contacts.length} contacts]` }));

      try {
        const res = await fetch('/api/campaigns/launch-batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        console.log('[Launch] Server response:', data);
        btnConfirmLaunchBatches.disabled = false;
        if (data.ok) {
          alert(`🎉 SUCCESS! Created ${data.totalCampaigns} campaign batches with ${data.totalQueued} emails queued!\nMode: ${selectedStrategy === 'SMART' ? 'Smart Send' : 'Controlled Send'}.\nThe background scheduler will dispatch each batch right on time.`);
          campaignPreFlightBox.style.display = 'none'; currentPreviewData = null;
          if (campaignCsvFileInput) campaignCsvFileInput.value = '';
          loadCampaigns(); refreshTelemetry();
          document.querySelector('.nav-tab[data-tab="tab-overview"]').click();
        } else { alert(data.error || 'Failed to launch batches.'); }
      } catch (err) { console.error('[Launch] Error:', err); btnConfirmLaunchBatches.disabled = false; alert('Error launching campaigns: ' + err.message); }
    };

    formLaunchBatches.addEventListener('submit', handleLaunchSubmit);
    if (btnConfirmLaunchBatches) {
      btnConfirmLaunchBatches.addEventListener('click', (e) => {
        handleLaunchSubmit(e);
      });
    }
  }

  // 8. ENHANCED CAMPAIGNS TABLE (Filter, Search, Sort, Pagination)
  async function loadCampaigns() {
    try {
      const res = await fetch('/api/campaigns');
      const data = await res.json();
      if (!data.ok) return;
      allCampaigns = data.campaigns || [];
      renderCampaignsTable();
    } catch (_) { }
  }

  // --- PARENT-CHILD CAMPAIGN GROUPING & AGGREGATION ---
  function groupCampaignsByMaster(campaignList) {
    const parentMap = new Map();
    const standalone = [];

    // Separate explicit parents vs child batches or infer by naming pattern
    for (const c of campaignList) {
      if (c.parent_id) {
        if (!parentMap.has(c.parent_id)) {
          parentMap.set(c.parent_id, []);
        }
        parentMap.get(c.parent_id).push(c);
      } else {
        // Check if this campaign has children or is a master
        if (!parentMap.has(c.id)) {
          parentMap.set(c.id, []);
        }
      }
    }

    const aggregatedGroups = [];

    for (const [parentId, children] of parentMap.entries()) {
      const parentCamp = campaignList.find(c => c.id === parentId);
      if (!parentCamp) {
        // If children without parent found in memory, add them standalone
        for (const ch of children) standalone.push(ch);
        continue;
      }

      // If parent has children, calculate aggregated metrics
      if (children.length > 0) {
        const totalCount = children.reduce((sum, ch) => sum + (ch.total_count || 0), 0);
        const sentCount = children.reduce((sum, ch) => sum + (ch.sent_count || 0), 0);
        const failedCount = children.reduce((sum, ch) => sum + (ch.failed_count || 0), 0);
        
        let aggregateStatus = 'COMPLETED';
        const hasRunning = children.some(ch => ch.status === 'RUNNING');
        const hasQueued = children.some(ch => ch.status === 'QUEUED' || ch.status === 'SCHEDULED');
        const hasPaused = children.some(ch => ch.status === 'PAUSED');
        const allCancelled = children.every(ch => ch.status === 'CANCELLED');

        if (hasRunning) aggregateStatus = 'RUNNING';
        else if (hasPaused) aggregateStatus = 'PAUSED';
        else if (hasQueued) aggregateStatus = 'QUEUED';
        else if (allCancelled) aggregateStatus = 'CANCELLED';

        aggregatedGroups.push({
          isMaster: true,
          parent: parentCamp,
          children: children.sort((a, b) => a.id - b.id),
          totalCount,
          sentCount,
          failedCount,
          status: aggregateStatus
        });
      } else {
        // Master campaign itself with direct queue or legacy standalone batch
        aggregatedGroups.push({
          isMaster: false,
          parent: parentCamp,
          children: [],
          totalCount: parentCamp.total_count || 0,
          sentCount: parentCamp.sent_count || 0,
          failedCount: parentCamp.failed_count || 0,
          status: parentCamp.status
        });
      }
    }

    return aggregatedGroups;
  }

  function renderCampaignsTable() {
    // 1. Filter
    let filtered = allCampaigns.filter(c => {
      if (currentCampFilter === 'RUNNING') return c.status === 'RUNNING';
      if (currentCampFilter === 'QUEUED') return c.status === 'QUEUED' || c.status === 'SCHEDULED';
      if (currentCampFilter === 'COMPLETED') return c.status === 'COMPLETED';
      if (currentCampFilter === 'FAILED') return c.failed_count > 0 || c.status === 'CANCELLED';
      if (currentCampFilter === 'TODAY') {
        const today = new Date().toDateString();
        const campDate = c.started_at ? new Date(c.started_at).toDateString() : (c.scheduled_at ? new Date(c.scheduled_at).toDateString() : '');
        return campDate === today;
      }
      return true; // ALL
    });

    // 2. Search
    if (campSearchQuery) {
      const q = campSearchQuery.toLowerCase();
      filtered = filtered.filter(c =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.template_name && c.template_name.toLowerCase().includes(q)) ||
        (c.sender_email && c.sender_email.toLowerCase().includes(q))
      );
    }

    // 3. Sort
    filtered.sort((a, b) => {
      if (campSortOrder === 'newest') return b.id - a.id;
      if (campSortOrder === 'oldest') return a.id - b.id;
      if (campSortOrder === 'running') {
        if (a.status === 'RUNNING' && b.status !== 'RUNNING') return -1;
        if (b.status === 'RUNNING' && a.status !== 'RUNNING') return 1;
        return b.id - a.id;
      }
      if (campSortOrder === 'scheduled') {
        const dateA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Infinity;
        const dateB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Infinity;
        return dateA - dateB;
      }
      if (campSortOrder === 'name') return (a.name || '').localeCompare(b.name || '');
      return 0;
    });

    // Update Counters
    document.getElementById('countCampAll').textContent = allCampaigns.length;
    document.getElementById('countCampRunning').textContent = allCampaigns.filter(c => c.status === 'RUNNING').length;
    document.getElementById('countCampQueued').textContent = allCampaigns.filter(c => c.status === 'QUEUED' || c.status === 'SCHEDULED').length;
    document.getElementById('countCampCompleted').textContent = allCampaigns.filter(c => c.status === 'COMPLETED').length;
    document.getElementById('countCampFailed').textContent = allCampaigns.filter(c => c.failed_count > 0 || c.status === 'CANCELLED').length;
    const todayStr = new Date().toDateString();
    document.getElementById('countCampToday').textContent = allCampaigns.filter(c => {
      const d = c.started_at ? new Date(c.started_at).toDateString() : (c.scheduled_at ? new Date(c.scheduled_at).toDateString() : '');
      return d === todayStr;
    }).length;

    const aggregatedContainer = document.getElementById('aggregatedCampaignsContainer');
    const rawTableWrapper = document.getElementById('rawCampaignsTableWrapper');

    if (campaignViewMode === 'aggregated') {
      aggregatedContainer.style.display = 'block';
      rawTableWrapper.style.display = 'none';

      const groups = groupCampaignsByMaster(filtered);

      if (groups.length === 0) {
        aggregatedContainer.innerHTML = `<div class="table-empty" style="padding: 30px; text-align: center;">No campaigns match your current filters.</div>`;
      } else {
        aggregatedContainer.innerHTML = groups.map(g => {
          const p = g.parent;
          const total = g.totalCount;
          const sent = g.sentCount;
          const failed = g.failedCount;
          const pct = total > 0 ? Math.min(100, Math.round(((sent + failed) / total) * 100)) : 0;

          let statusBadgeClass = 'badge-queued';
          if (g.status === 'COMPLETED') statusBadgeClass = 'badge-completed';
          else if (g.status === 'RUNNING') statusBadgeClass = 'badge-sending';
          else if (g.status === 'PAUSED') statusBadgeClass = 'badge-paused';
          else if (g.status === 'SCHEDULED') statusBadgeClass = 'badge-scheduled';
          else if (g.status === 'CANCELLED') statusBadgeClass = 'badge-cancelled';

          const allChildIds = g.children.length > 0 ? g.children.map(ch => ch.id) : [p.id];
          const childIdsAttr = allChildIds.join(',');

          // Bulk Control Buttons
          let bulkActionsHtml = '';
          if (g.status === 'RUNNING') {
            bulkActionsHtml = `
              <button type="button" class="btn btn-secondary btn-xs btn-bulk-action" data-action="PAUSED" data-ids="${childIdsAttr}">⏸️ Pause All</button>
              <button type="button" class="btn btn-danger btn-xs btn-bulk-action" data-action="CANCELLED" data-ids="${childIdsAttr}">✕ Cancel All</button>
            `;
          } else if (g.status === 'PAUSED') {
            bulkActionsHtml = `
              <button type="button" class="btn btn-primary btn-xs btn-bulk-action" data-action="RESUMED" data-ids="${childIdsAttr}">▶️ Resume All</button>
              <button type="button" class="btn btn-danger btn-xs btn-bulk-action" data-action="CANCELLED" data-ids="${childIdsAttr}">✕ Cancel All</button>
            `;
          } else if (g.status === 'SCHEDULED' || g.status === 'QUEUED') {
            bulkActionsHtml = `
              <button type="button" class="btn btn-primary btn-xs btn-bulk-send-now" data-id="${p.id}" title="Trigger immediately">⚡ Send Now</button>
              <button type="button" class="btn btn-danger btn-xs btn-bulk-action" data-action="CANCELLED" data-ids="${childIdsAttr}">✕ Cancel</button>
            `;
          }

          // Sub-batches List
          const childrenHtml = g.children.map(ch => {
            const chPct = ch.total_count > 0 ? Math.min(100, Math.round((ch.sent_count / ch.total_count) * 100)) : 0;
            let chStatusBadge = 'badge-queued';
            if (ch.status === 'COMPLETED') chStatusBadge = 'badge-completed';
            else if (ch.status === 'RUNNING') chStatusBadge = 'badge-sending';
            else if (ch.status === 'PAUSED') chStatusBadge = 'badge-paused';
            else if (ch.status === 'CANCELLED') chStatusBadge = 'badge-cancelled';

            return `
              <div class="child-batch-row">
                <div>
                  <strong style="color: var(--sky); cursor: pointer;" class="btn-inspect-batch" data-id="${ch.id}" title="Click to inspect batch details">${escapeHtml(ch.name)}</strong>
                  <span class="mono" style="margin-left: 6px;">#${ch.id}</span>
                </div>
                <div><span class="badge ${chStatusBadge}" style="font-size: 10px;">${ch.status}</span></div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div class="gauge-bar-bg" style="width: 50px; height: 5px; margin: 0;"><div class="gauge-bar-fill" style="width: ${chPct}%;"></div></div>
                  <span style="font-size: 11px;">${ch.sent_count}/${ch.total_count}</span>
                </div>
                <div class="mono" style="font-size: 11px; color: var(--text-muted);">${formatDateTime(ch.started_at || ch.scheduled_at)}</div>
                <div>
                  <button type="button" class="btn btn-secondary btn-xs btn-inspect-batch" data-id="${ch.id}">🔍 Inspect</button>
                </div>
              </div>
            `;
          }).join('');

          return `
            <div class="parent-campaign-card" id="parentCard_${p.id}">
              <div class="parent-campaign-header" data-id="${p.id}">
                <div class="parent-title-group">
                  <span class="parent-chevron">▶</span>
                  <div>
                    <h4 style="margin: 0; font-size: 14px; color: var(--text-primary);">${escapeHtml(p.name)}</h4>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                      ${g.children.length > 0 ? `📁 Master Sheet (${g.children.length} Batches)` : 'Single Campaign'} • ${escapeHtml(p.template_name || 'Template')}
                    </div>
                  </div>
                  <span class="badge ${statusBadgeClass}" style="margin-left: 6px;">${g.status}</span>
                </div>

                <div class="parent-metrics-group">
                  <div class="parent-progress-bar-bg">
                    <div class="parent-progress-bar-fill" style="width: ${pct}%;"></div>
                  </div>
                  <div style="font-size: 11.5px; font-weight: 600; min-width: 90px; text-align: right;">
                    ${sent} / ${total} <span style="color: var(--text-muted);">(${pct}%)</span>
                  </div>
                </div>

                <div class="parent-actions-group" onclick="event.stopPropagation();">
                  ${bulkActionsHtml}
                  ${g.children.length > 0 ? `<button type="button" class="btn btn-secondary btn-xs btn-toggle-expand" data-id="${p.id}">Expand Batches (${g.children.length})</button>` : `<button type="button" class="btn btn-secondary btn-xs btn-inspect-batch" data-id="${p.id}">🔍 Inspect</button>`}
                </div>
              </div>

              ${g.children.length > 0 ? `<div class="child-batches-container" id="childrenContainer_${p.id}">${childrenHtml}</div>` : ''}
            </div>
          `;
        }).join('');

        // Wire parent card accordion toggles
        aggregatedContainer.querySelectorAll('.parent-campaign-header').forEach(header => {
          header.addEventListener('click', () => {
            const card = header.closest('.parent-campaign-card');
            card.classList.toggle('open');
            const expandBtn = card.querySelector('.btn-toggle-expand');
            if (expandBtn) {
              expandBtn.textContent = card.classList.contains('open') ? 'Collapse' : `Expand Batches (${card.querySelectorAll('.child-batch-row').length})`;
            }
          });
        });

        // Wire bulk action buttons
        aggregatedContainer.querySelectorAll('.btn-bulk-action').forEach(btn => {
          btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            const ids = btn.dataset.ids.split(',').map(id => parseInt(id, 10));
            if (action === 'CANCELLED' && !confirm(`Cancel all ${ids.length} batch(es)? Remaining emails will be cancelled.`)) return;

            btn.disabled = true;
            try {
              await fetch('/api/campaigns/bulk-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ campaignIds: ids, action })
              });
              loadCampaigns();
              refreshTelemetry();
            } catch (err) {
              alert(err.message);
            } finally {
              btn.disabled = false;
            }
          });
        });

        // Wire bulk send now
        aggregatedContainer.querySelectorAll('.btn-bulk-send-now').forEach(btn => {
          btn.addEventListener('click', async () => {
            btn.disabled = true;
            try {
              await fetch(`/api/campaigns/${btn.dataset.id}/send-now`, { method: 'POST' });
              loadCampaigns();
              refreshTelemetry();
            } catch (err) {
              alert(err.message);
            } finally {
              btn.disabled = false;
            }
          });
        });

        // Wire inspection drawer trigger
        aggregatedContainer.querySelectorAll('.btn-inspect-batch').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openCampaignInspectionDrawer(btn.dataset.id);
          });
        });
      }

    } else {
      // RAW TABLE VIEW
      aggregatedContainer.style.display = 'none';
      rawTableWrapper.style.display = 'block';

      // 4. Pagination
      const totalItems = filtered.length;
      const totalPages = campPageSize === 'all' ? 1 : Math.ceil(totalItems / campPageSize) || 1;
      if (campCurrentPage > totalPages) campCurrentPage = totalPages;
      const startIdx = campPageSize === 'all' ? 0 : (campCurrentPage - 1) * campPageSize;
      const endIdx = campPageSize === 'all' ? totalItems : startIdx + campPageSize;
      const pageItems = filtered.slice(startIdx, endIdx);

      // Render Table
      if (pageItems.length === 0) {
        campaignsTableBody.innerHTML = `<tr><td colspan="8" class="table-empty">No campaigns match your filters.</td></tr>`;
      } else {
        campaignsTableBody.innerHTML = pageItems.map((c) => {
          let statusBadgeClass = 'badge-queued';
          if (c.status === 'COMPLETED') statusBadgeClass = 'badge-completed';
          else if (c.status === 'RUNNING') statusBadgeClass = 'badge-sending';
          else if (c.status === 'PAUSED') statusBadgeClass = 'badge-paused';
          else if (c.status === 'SCHEDULED') statusBadgeClass = 'badge-scheduled';
          else if (c.status === 'CANCELLED') statusBadgeClass = 'badge-cancelled';

          let actionsHtml = '';
          if (c.status === 'RUNNING') {
            actionsHtml = `<button type="button" class="btn btn-secondary btn-xs btn-pause-camp" data-id="${c.id}">Pause</button><button type="button" class="btn btn-danger btn-xs btn-cancel-camp" data-id="${c.id}">Cancel</button>`;
          } else if (c.status === 'PAUSED') {
            actionsHtml = `<button type="button" class="btn btn-primary btn-xs btn-resume-camp" data-id="${c.id}">Resume</button><button type="button" class="btn btn-danger btn-xs btn-cancel-camp" data-id="${c.id}">Cancel</button>`;
          } else if (c.status === 'SCHEDULED' || c.status === 'QUEUED') {
            actionsHtml = `<button type="button" class="btn btn-primary btn-xs btn-send-now" data-id="${c.id}">⚡ Send</button><button type="button" class="btn btn-danger btn-xs btn-cancel-camp" data-id="${c.id}">Cancel</button>`;
          } else {
            actionsHtml = `<button type="button" class="btn btn-secondary btn-xs btn-inspect-batch" data-id="${c.id}">🔍 Inspect</button>`;
          }

          const timeDisplay = c.started_at ? `Started: ${formatDateTime(c.started_at)}` : (c.scheduled_at ? `Scheduled: ${formatDateTime(c.scheduled_at)}` : '--');
          const progressPct = c.total_count > 0 ? Math.round(((c.sent_count + c.failed_count) / c.total_count) * 100) : 0;

          return `
            <tr>
              <td>#${c.id}</td>
              <td><strong title="${escapeHtml(c.name)}" class="btn-inspect-batch" data-id="${c.id}" style="cursor: pointer; color: var(--sky);">${escapeHtml(c.name)}</strong></td>
              <td>${escapeHtml(c.template_name || '--')}</td>
              <td><span class="account-badge">${c.sender_email || 'Smart Pool'}</span></td>
              <td><span style="font-size: 11px; color: var(--text-secondary);">${timeDisplay}</span></td>
              <td><span class="badge ${statusBadgeClass}">${c.status}</span></td>
              <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div class="gauge-bar-bg" style="width: 50px; height: 5px; margin: 0;"><div class="gauge-bar-fill" style="width: ${progressPct}%;"></div></div>
                  <span style="font-size: 11px;">${c.sent_count} / ${c.total_count}</span>
                </div>
              </td>
              <td>${actionsHtml}</td>
            </tr>
          `;
        }).join('');

        campaignsTableBody.querySelectorAll('.btn-pause-camp').forEach(btn => btn.addEventListener('click', async () => { await fetch(`/api/campaigns/${btn.dataset.id}/pause`, { method: 'POST' }); loadCampaigns(); refreshTelemetry(); }));
        campaignsTableBody.querySelectorAll('.btn-resume-camp').forEach(btn => btn.addEventListener('click', async () => { await fetch(`/api/campaigns/${btn.dataset.id}/resume`, { method: 'POST' }); loadCampaigns(); refreshTelemetry(); }));
        campaignsTableBody.querySelectorAll('.btn-cancel-camp').forEach(btn => btn.addEventListener('click', async () => { if (!confirm('Cancel this campaign? Any unsent emails will be stopped.')) return; await fetch(`/api/campaigns/${btn.dataset.id}/cancel`, { method: 'POST' }); loadCampaigns(); refreshTelemetry(); }));
        campaignsTableBody.querySelectorAll('.btn-send-now').forEach(btn => btn.addEventListener('click', async () => { await fetch(`/api/campaigns/${btn.dataset.id}/send-now`, { method: 'POST' }); loadCampaigns(); refreshTelemetry(); }));
        campaignsTableBody.querySelectorAll('.btn-inspect-batch').forEach(btn => btn.addEventListener('click', () => { openCampaignInspectionDrawer(btn.dataset.id); }));
      }

      document.getElementById('campaignPageInfo').textContent = `Showing ${totalItems === 0 ? 0 : startIdx + 1}–${endIdx} of ${totalItems} campaigns`;
      document.getElementById('campPageNumbers').textContent = `Page ${campCurrentPage} / ${totalPages}`;
      document.getElementById('btnCampPrev').disabled = campCurrentPage <= 1;
      document.getElementById('btnCampNext').disabled = campCurrentPage >= totalPages;
    }
  }

  // View Mode Switcher Listener
  const btnToggleCampaignViewMode = document.getElementById('btnToggleCampaignViewMode');
  if (btnToggleCampaignViewMode) {
    btnToggleCampaignViewMode.addEventListener('click', () => {
      campaignViewMode = campaignViewMode === 'aggregated' ? 'table' : 'aggregated';
      btnToggleCampaignViewMode.textContent = campaignViewMode === 'aggregated' ? '🗂️ View: Grouped Master Sheets' : '📋 View: Raw Batches Table';
      renderCampaignsTable();
    });
  }

  // --- SLIDE-OVER INSPECTION DRAWER CONTROLLER ---
  const campaignDrawer = document.getElementById('campaignDrawer');
  const drawerBackdrop = document.getElementById('drawerBackdrop');
  const btnCloseDrawer = document.getElementById('btnCloseDrawer');
  const btnDrawerCloseFooter = document.getElementById('btnDrawerCloseFooter');

  function closeCampaignDrawer() {
    if (campaignDrawer) campaignDrawer.classList.remove('active');
    if (drawerBackdrop) drawerBackdrop.classList.remove('active');
  }

  if (btnCloseDrawer) btnCloseDrawer.addEventListener('click', closeCampaignDrawer);
  if (btnDrawerCloseFooter) btnDrawerCloseFooter.addEventListener('click', closeCampaignDrawer);
  if (drawerBackdrop) drawerBackdrop.addEventListener('click', closeCampaignDrawer);

  async function openCampaignInspectionDrawer(campaignId) {
    if (!campaignDrawer) return;

    campaignDrawer.classList.add('active');
    drawerBackdrop.classList.add('active');

    const drawerBatchName = document.getElementById('drawerBatchName');
    const drawerBatchStatus = document.getElementById('drawerBatchStatus');
    const drawerMetricTotal = document.getElementById('drawerMetricTotal');
    const drawerMetricSent = document.getElementById('drawerMetricSent');
    const drawerMetricFailed = document.getElementById('drawerMetricFailed');
    const drawerTableBody = document.getElementById('drawerRecipientsTableBody');

    drawerBatchName.textContent = `Loading Campaign #${campaignId}...`;
    drawerTableBody.innerHTML = `<tr><td colspan="4" class="table-empty">Loading live recipient records...</td></tr>`;

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/preview`);
      const data = await res.json();
      if (!data.ok || !data.campaign) {
        drawerBatchName.textContent = `Campaign #${campaignId}`;
        drawerTableBody.innerHTML = `<tr><td colspan="4" class="table-empty">Campaign records not found.</td></tr>`;
        return;
      }

      drawerBatchName.textContent = data.campaign.name || `Campaign #${campaignId}`;
      drawerBatchStatus.textContent = data.campaign.status;
      drawerBatchStatus.className = `badge badge-${data.campaign.status.toLowerCase()}`;

      if (data.summary) {
        drawerMetricTotal.textContent = data.summary.total || 0;
        drawerMetricSent.textContent = data.summary.sent || 0;
        drawerMetricFailed.textContent = data.summary.failed || 0;
      }

      if (!data.sampleItems || data.sampleItems.length === 0) {
        drawerTableBody.innerHTML = `<tr><td colspan="4" class="table-empty">No queue records found for this batch.</td></tr>`;
      } else {
        drawerTableBody.innerHTML = data.sampleItems.map(item => {
          let stColor = 'var(--text-muted)';
          if (item.status === 'sent') stColor = 'var(--emerald)';
          else if (item.status === 'failed') stColor = 'var(--rose)';
          else if (item.status === 'sending') stColor = 'var(--sky)';

          return `
            <tr>
              <td style="font-family: var(--font-mono); font-size: 11px;">${escapeHtml(item.email)}</td>
              <td><span style="color: ${stColor}; font-weight: 600; font-size: 11px;">${item.status}</span></td>
              <td>${item.attempts || 0}</td>
              <td style="font-size: 10.5px; color: ${item.last_error ? 'var(--rose)' : 'var(--text-muted)'}; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(item.last_error || '')}">
                ${escapeHtml(item.last_error || '--')}
              </td>
            </tr>
          `;
        }).join('');
      }
    } catch (err) {
      drawerTableBody.innerHTML = `<tr><td colspan="4" class="table-empty" style="color: var(--rose);">Error: ${err.message}</td></tr>`;
    }
  }

  // Campaign Filter, Search, Sort, Pagination Event Listeners
  document.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentCampFilter = pill.dataset.filter;
      campCurrentPage = 1;
      renderCampaignsTable();
    });
  });

  document.getElementById('campaignSearchInput').addEventListener('input', (e) => {
    campSearchQuery = e.target.value;
    campCurrentPage = 1;
    renderCampaignsTable();
  });

  document.getElementById('campaignSortSelect').addEventListener('change', (e) => {
    campSortOrder = e.target.value;
    renderCampaignsTable();
  });

  document.getElementById('campaignPageSizeSelect').addEventListener('change', (e) => {
    campPageSize = e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10);
    campCurrentPage = 1;
    renderCampaignsTable();
  });

  document.getElementById('btnCampPrev').addEventListener('click', () => {
    if (campCurrentPage > 1) { campCurrentPage--; renderCampaignsTable(); }
  });

  document.getElementById('btnCampNext').addEventListener('click', () => {
    const totalPages = campPageSize === 'all' ? 1 : Math.ceil((allCampaigns.filter(c => {
      if (currentCampFilter === 'RUNNING') return c.status === 'RUNNING';
      if (currentCampFilter === 'QUEUED') return c.status === 'QUEUED' || c.status === 'SCHEDULED';
      if (currentCampFilter === 'COMPLETED') return c.status === 'COMPLETED';
      if (currentCampFilter === 'FAILED') return c.failed_count > 0 || c.status === 'CANCELLED';
      if (currentCampFilter === 'TODAY') {
        const today = new Date().toDateString();
        const campDate = c.started_at ? new Date(c.started_at).toDateString() : (c.scheduled_at ? new Date(c.scheduled_at).toDateString() : '');
        return campDate === today;
      }
      return true;
    }).length) / campPageSize) || 1;
    if (campCurrentPage < totalPages) { campCurrentPage++; renderCampaignsTable(); }
  });

  // 9. DETAILED DELIVERY AUDIT LOGS (Paginated & Zero-Flicker)
  let logsCurrentPage = 1;
  let logsPageSize = 50;
  let isLogsFetching = false;

  const logsPageIndicator = document.getElementById('logsPageIndicator');
  const btnLogsPrevPage = document.getElementById('btnLogsPrevPage');
  const btnLogsNextPage = document.getElementById('btnLogsNextPage');
  const logsPageSizeSelect = document.getElementById('logsPageSizeSelect');

  async function loadDetailedLogs() {
    const logsTableBody = document.getElementById('detailedLogsTableBody');
    const logsSearchInput = document.getElementById('logsSearchInput');
    const logsStatusFilter = document.getElementById('logsStatusFilter');
    const logsCampaignFilter = document.getElementById('logsCampaignFilter');

    if (!logsTableBody || isLogsFetching) return;
    isLogsFetching = true;

    const search = logsSearchInput?.value.trim() || '';
    const status = logsStatusFilter?.value || '';
    const campaignId = logsCampaignFilter?.value || '';
    const offset = (logsCurrentPage - 1) * logsPageSize;

    try {
      const params = new URLSearchParams({
        limit: logsPageSize,
        offset: offset
      });
      if (search) params.append('search', search);
      if (status) params.append('status', status);
      if (campaignId) params.append('campaignId', campaignId);

      const res = await fetch(`/api/delivery-logs?${params}`);
      const data = await res.json();

      if (!data.ok || !data.logs || data.logs.length === 0) {
        if (data.total && data.total > 0 && logsCurrentPage > 1) {
          logsCurrentPage = Math.max(1, Math.ceil(data.total / logsPageSize));
          isLogsFetching = false;
          return loadDetailedLogs();
        }
        logsTableBody.innerHTML = `<tr><td colspan="10" class="table-empty">No delivery logs found.</td></tr>`;
        const statsEl = document.getElementById('logsStatsSummary');
        if (statsEl) statsEl.textContent = 'Showing 0 logs';
        if (logsPageIndicator) logsPageIndicator.textContent = 'Page 1 of 1 (0 logs)';
        if (btnLogsPrevPage) btnLogsPrevPage.disabled = true;
        if (btnLogsNextPage) btnLogsNextPage.disabled = true;
        return;
      }

      logsTableBody.innerHTML = data.logs.map(log => {
        let statusBadge = '';
        if (log.status === 'sent') statusBadge = '<span class="badge badge-completed">✓ Sent</span>';
        else if (log.status === 'failed') statusBadge = '<span class="badge badge-failed">✗ Failed</span>';
        else if (log.status === 'sending') statusBadge = '<span class="badge badge-sending">⏳ Sending</span>';
        else statusBadge = '<span class="badge badge-queued">⏸ Queued</span>';

        const errorCell = log.error_message 
          ? `<span style="color: var(--rose); font-size: 11px;" title="${escapeHtml(log.error_message)}">${escapeHtml(log.error_message.substring(0, 40))}${log.error_message.length > 40 ? '...' : ''}</span>`
          : '<span style="color: var(--text-muted);">-</span>';

        return `
          <tr>
            <td style="font-family: var(--font-mono); font-size: 11px;">${new Date(log.created_at).toLocaleTimeString()}</td>
            <td><strong style="color: var(--sky);">${escapeHtml(log.recipient_email)}</strong></td>
            <td style="font-size: 11px;">${escapeHtml(log.recipient_name || '-')}</td>
            <td><span class="account-badge">${escapeHtml(log.sender_email)}</span></td>
            <td style="font-size: 11px;">${escapeHtml(log.campaign_name || '-')}</td>
            <td style="font-size: 11px;">${escapeHtml(log.template_name || '-')}</td>
            <td>${statusBadge}</td>
            <td style="font-family: var(--font-mono); font-size: 11px;">${log.attempts || 0}</td>
            <td>${errorCell}</td>
            <td>
              <button type="button" class="btn btn-secondary btn-xs btn-view-log-detail" data-id="${log.id}" style="padding: 2px 6px; font-size: 10px;">
                🔍 View
              </button>
            </td>
          </tr>
        `;
      }).join('');

      // Wire detail buttons
      logsTableBody.querySelectorAll('.btn-view-log-detail').forEach(btn => {
        btn.addEventListener('click', () => viewLogDetails(btn.dataset.id));
      });

      const totalLogs = data.total !== undefined ? data.total : data.logs.length;
      const totalPages = Math.ceil(totalLogs / logsPageSize) || 1;

      const statsEl = document.getElementById('logsStatsSummary');
      if (statsEl) {
        statsEl.textContent = `Showing ${data.logs.length} of ${totalLogs} logs`;
      }

      if (logsPageIndicator) {
        logsPageIndicator.textContent = `Page ${logsCurrentPage} of ${totalPages} (${totalLogs} total logs)`;
      }
      if (btnLogsPrevPage) btnLogsPrevPage.disabled = logsCurrentPage <= 1;
      if (btnLogsNextPage) btnLogsNextPage.disabled = logsCurrentPage >= totalPages;

    } catch (err) {
      logsTableBody.innerHTML = `<tr><td colspan="10" class="table-empty" style="color: var(--rose);">Error loading logs: ${escapeHtml(err.message)}</td></tr>`;
    } finally {
      isLogsFetching = false;
    }
  }

  // Logs Pagination Listeners
  if (btnLogsPrevPage) {
    btnLogsPrevPage.addEventListener('click', () => {
      if (logsCurrentPage > 1) {
        logsCurrentPage--;
        loadDetailedLogs();
      }
    });
  }

  if (btnLogsNextPage) {
    btnLogsNextPage.addEventListener('click', () => {
      logsCurrentPage++;
      loadDetailedLogs();
    });
  }

  if (logsPageSizeSelect) {
    logsPageSizeSelect.addEventListener('change', () => {
      logsPageSize = parseInt(logsPageSizeSelect.value, 10) || 50;
      logsCurrentPage = 1;
      loadDetailedLogs();
    });
  }

  async function viewLogDetails(logId) {
    try {
      const res = await fetch(`/api/delivery-logs/${logId}`);
      const data = await res.json();
      if (!data.ok) {
        alert('Failed to load log details');
        return;
      }
      const log = data.log;
      const detailsHtml = `
        <div style="max-height: 70vh; overflow-y: auto;">
          <h3 style="color: var(--sky); margin-bottom: 16px;">📧 Email Delivery Details</h3>
          
          <div style="background: var(--bg-input); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px;">
              <div><strong>Recipient:</strong> ${escapeHtml(log.recipient_email)}</div>
              <div><strong>Name:</strong> ${escapeHtml(log.recipient_name || '-')}</div>
              <div><strong>Sender:</strong> ${escapeHtml(log.sender_email)}</div>
              <div><strong>Provider:</strong> ${escapeHtml(log.sender_provider)}</div>
              <div><strong>Campaign:</strong> ${escapeHtml(log.campaign_name || '-')}</div>
              <div><strong>Template:</strong> ${escapeHtml(log.template_name || '-')}</div>
              <div><strong>Status:</strong> <span class="badge badge-${log.status === 'sent' ? 'completed' : log.status === 'failed' ? 'failed' : 'queued'}">${log.status.toUpperCase()}</span></div>
              <div><strong>Attempts:</strong> ${log.attempts || 0}</div>
            </div>
          </div>

          <div style="background: var(--bg-input); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <h4 style="color: var(--text-primary); margin-bottom: 12px;">📋 Subject</h4>
            <div style="font-size: 13px; color: var(--text-secondary);">${escapeHtml(log.subject)}</div>
          </div>

          ${log.error_message ? `
          <div style="background: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.3); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <h4 style="color: var(--rose); margin-bottom: 8px;">❌ Error Details</h4>
            <div style="font-size: 12px; font-family: var(--font-mono); color: var(--text-primary); white-space: pre-wrap;">${escapeHtml(log.error_message)}</div>
          </div>
          ` : ''}

          <div style="background: var(--bg-input); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
            <h4 style="color: var(--text-primary); margin-bottom: 12px;">🕐 Timeline</h4>
            <div style="font-size: 12px; color: var(--text-secondary);">
              <div><strong>Queued:</strong> ${log.queued_at ? new Date(log.queued_at).toLocaleString() : '-'}</div>
              <div><strong>Started:</strong> ${log.started_at ? new Date(log.started_at).toLocaleString() : '-'}</div>
              <div><strong>Completed:</strong> ${log.completed_at ? new Date(log.completed_at).toLocaleString() : '-'}</div>
              <div><strong>Created:</strong> ${new Date(log.created_at).toLocaleString()}</div>
            </div>
          </div>

          ${log.provider_message_id ? `
          <div style="background: var(--bg-input); padding: 16px; border-radius: 8px;">
            <h4 style="color: var(--text-primary); margin-bottom: 8px;">🔗 Provider Message ID</h4>
            <div style="font-size: 11px; font-family: var(--font-mono); color: var(--sky); word-break: break-all;">${escapeHtml(log.provider_message_id)}</div>
          </div>
          ` : ''}
        </div>
      `;

      const modal = document.getElementById('logDetailsModal');
      if (modal) {
        modal.querySelector('.modal-card').innerHTML = detailsHtml + `
          <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
            <button class="btn btn-secondary btn-close-log-modal">Close</button>
          </div>
        `;
        modal.querySelector('.btn-close-log-modal').onclick = () => { modal.style.display = 'none'; };
        modal.style.display = 'flex';
      }
    } catch (err) {
      alert('Error loading log details: ' + err.message);
    }
  }

  window.viewLogDetails = viewLogDetails;

  // Filter Listeners for Tab 6
  const btnApplyLogsFilter = document.getElementById('btnApplyLogsFilter');
  const btnClearLogsFilter = document.getElementById('btnClearLogsFilter');
  const logsSearchInput = document.getElementById('logsSearchInput');

  if (btnRefreshLogs) btnRefreshLogs.addEventListener('click', () => { logsCurrentPage = 1; loadDetailedLogs(); });
  if (btnApplyLogsFilter) btnApplyLogsFilter.addEventListener('click', () => { logsCurrentPage = 1; loadDetailedLogs(); });
  if (btnClearLogsFilter) {
    btnClearLogsFilter.addEventListener('click', () => {
      if (logsSearchInput) logsSearchInput.value = '';
      const statusFilter = document.getElementById('logsStatusFilter');
      const campaignFilter = document.getElementById('logsCampaignFilter');
      if (statusFilter) statusFilter.value = '';
      if (campaignFilter) campaignFilter.value = '';
      logsCurrentPage = 1;
      loadDetailedLogs();
    });
  }

  if (logsSearchInput) {
    logsSearchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        logsCurrentPage = 1;
        loadDetailedLogs();
      }
    });
  }

  async function loadCampaignsForLogsFilter() {
    try {
      const res = await fetch('/api/campaigns');
      const data = await res.json();
      if (!data.ok) return;
      const campaignFilter = document.getElementById('logsCampaignFilter');
      if (campaignFilter) {
        campaignFilter.innerHTML = '<option value="">All Campaigns</option>' +
          (data.campaigns || []).map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
      }
    } catch (_) {}
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  // 10. QUICK ACTIONS & QUICK TEST MODAL
  const modalQuickTest = document.getElementById('modalQuickTest');
  const btnOpenQuickTest = document.getElementById('btnOpenQuickTest');
  const btnCloseQuickTest = document.getElementById('btnCloseQuickTest');
  const btnCancelQuickTest = document.getElementById('btnCancelQuickTest');
  const formQuickTest = document.getElementById('formQuickTest');
  const quickTestToEmail = document.getElementById('quickTestToEmail');
  const quickTestName = document.getElementById('quickTestName');
  const quickTestSubject = document.getElementById('quickTestSubject');
  const quickTestResult = document.getElementById('quickTestResult');
  const btnSubmitQuickTest = document.getElementById('btnSubmitQuickTest');

  function openQuickTestModal() {
    if (!modalQuickTest) return;
    quickTestResult.style.display = 'none'; modalQuickTest.style.display = 'flex';
    if (quickTestToEmail) quickTestToEmail.focus();
  }
  function closeQuickTestModal() { if (modalQuickTest) modalQuickTest.style.display = 'none'; }

  if (btnOpenQuickTest) btnOpenQuickTest.addEventListener('click', openQuickTestModal);
  if (btnCloseQuickTest) btnCloseQuickTest.addEventListener('click', closeQuickTestModal);
  if (btnCancelQuickTest) btnCancelQuickTest.addEventListener('click', closeQuickTestModal);
  modalQuickTest?.addEventListener('click', (e) => { if (e.target === modalQuickTest) closeQuickTestModal(); });

  formQuickTest?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const toEmail = quickTestToEmail.value.trim();
    const name = quickTestName.value.trim();
    const subject = quickTestSubject.value.trim();
    btnSubmitQuickTest.disabled = true; btnSubmitQuickTest.textContent = '⏳ Dispatching...';
    quickTestResult.style.display = 'none';
    const senderAccountIdVal = document.getElementById('quickTestSenderAccount')?.value;
    try {
      const res = await fetch('/api/send-test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toEmail, name, subject, senderAccountId: senderAccountIdVal ? parseInt(senderAccountIdVal, 10) : null }) });
      const data = await res.json();
      quickTestResult.style.display = 'block';
      if (data.ok) {
        quickTestResult.style.background = 'rgba(16, 185, 129, 0.15)'; quickTestResult.style.color = 'var(--emerald)'; quickTestResult.style.border = '1px solid rgba(16, 185, 129, 0.4)';
        quickTestResult.innerHTML = `✅ <b>Dispatched!</b> ${escapeHtml(data.message)}<br/><span style="font-size: 11px;">Message handed to Microsoft Graph API. Check recipient inbox/spam.</span>`;
        refreshTelemetry();
      } else {
        quickTestResult.style.background = 'rgba(244, 63, 94, 0.15)'; quickTestResult.style.color = 'var(--rose)'; quickTestResult.style.border = '1px solid rgba(244, 63, 94, 0.4)';
        quickTestResult.innerHTML = `❌ <b>Error:</b> ${escapeHtml(data.error)}`;
      }
    } catch (err) {
      quickTestResult.style.display = 'block'; quickTestResult.style.background = 'rgba(244, 63, 94, 0.15)'; quickTestResult.style.color = 'var(--rose)'; quickTestResult.style.border = '1px solid rgba(244, 63, 94, 0.4)';
      quickTestResult.innerHTML = `❌ <b>Network error:</b> ${escapeHtml(err.message)}`;
    } finally {
      btnSubmitQuickTest.disabled = false; btnSubmitQuickTest.textContent = '🚀 Send Test Now';
    }
  });

  // 11. CAMPAIGN PREVIEW & RE-RUN MODAL
  const modalCampaignPreview = document.getElementById('modalCampaignPreview');
  const btnCloseCampaignPreview = document.getElementById('btnCloseCampaignPreview');
  const btnCancelCampaignPreview = document.getElementById('btnCancelCampaignPreview');
  const previewModalCampName = document.getElementById('previewModalCampName');
  const previewModalCampMeta = document.getElementById('previewModalCampMeta');
  const previewModalTotal = document.getElementById('previewModalTotal');
  const previewModalSent = document.getElementById('previewModalSent');
  const previewModalFailed = document.getElementById('previewModalFailed');
  const previewModalQueued = document.getElementById('previewModalQueued');
  const previewModalTableBody = document.getElementById('previewModalTableBody');
  const rerunModeSelect = document.getElementById('rerunModeSelect');
  const rerunCampaignNameInput = document.getElementById('rerunCampaignNameInput');
  const chkRerunTemplateRotation = document.getElementById('chkRerunTemplateRotation');
  const rerunSingleTemplateBox = document.getElementById('rerunSingleTemplateBox');
  const rerunTemplateSelect = document.getElementById('rerunTemplateSelect');
  const rerunMultiTemplateBox = document.getElementById('rerunMultiTemplateBox');
  const rerunTemplateCheckboxesList = document.getElementById('rerunTemplateCheckboxesList');
  const rerunControlledOptions = document.getElementById('rerunControlledOptions');
  const rerunSenderAccountSelect = document.getElementById('rerunSenderAccountSelect');
  const chkRerunFallbackAllowed = document.getElementById('chkRerunFallbackAllowed');
  const rerunCustomIntervalBox = document.getElementById('rerunCustomIntervalBox');
  const inputRerunCustomIntervalSec = document.getElementById('inputRerunCustomIntervalSec');
  const btnTriggerRerun = document.getElementById('btnTriggerRerun');
  let activePreviewCampaignId = null;

  // Re-run UI interactions
  if (chkRerunTemplateRotation) {
    chkRerunTemplateRotation.addEventListener('change', () => {
      const isRot = chkRerunTemplateRotation.checked;
      if (rerunSingleTemplateBox) rerunSingleTemplateBox.style.display = isRot ? 'none' : 'block';
      if (rerunMultiTemplateBox) rerunMultiTemplateBox.style.display = isRot ? 'block' : 'none';
    });
  }

  document.querySelectorAll('input[name="rerunStrategyRadio"]').forEach(r => {
    r.addEventListener('change', () => {
      if (rerunControlledOptions) {
        rerunControlledOptions.style.display = r.value === 'CONTROLLED' ? 'block' : 'none';
      }
    });
  });

  document.querySelectorAll('input[name="rerunSpeedPreset"]').forEach(r => {
    r.addEventListener('change', () => {
      if (rerunCustomIntervalBox) {
        rerunCustomIntervalBox.style.display = r.value === 'CUSTOM' ? 'flex' : 'none';
      }
    });
  });

  const btnToggleRerunDrawer = document.getElementById('btnToggleRerunDrawer');
  const rerunDrawerBox = document.getElementById('rerunDrawerBox');

  if (btnToggleRerunDrawer && rerunDrawerBox) {
    btnToggleRerunDrawer.addEventListener('click', () => {
      const isClosed = rerunDrawerBox.style.display === 'none' || !rerunDrawerBox.style.display;
      rerunDrawerBox.style.display = isClosed ? 'block' : 'none';
      btnToggleRerunDrawer.textContent = isClosed ? '✕ Close Re-run Controls' : '🔄 Configure Re-run / Retry';
      btnToggleRerunDrawer.classList.toggle('btn-primary', isClosed);
      btnToggleRerunDrawer.classList.toggle('btn-secondary', !isClosed);
    });
  }

  async function openCampaignPreviewModal(campaignId) {
    if (!modalCampaignPreview) return;
    activePreviewCampaignId = campaignId; 
    modalCampaignPreview.style.display = 'flex';
    previewModalTableBody.innerHTML = '<tr><td colspan="6" class="table-empty">⏳ Loading campaign details and queue snapshot...</td></tr>';

    // Reset drawer state
    if (rerunDrawerBox) rerunDrawerBox.style.display = 'none';
    if (btnToggleRerunDrawer) {
      btnToggleRerunDrawer.textContent = '🔄 Configure Re-run / Retry';
      btnToggleRerunDrawer.className = 'btn btn-secondary btn-sm';
    }

    // Populate templates dropdown and checkboxes in Re-run modal
    if (rerunTemplateSelect && allLoadedTemplates.length > 0) {
      rerunTemplateSelect.innerHTML = allLoadedTemplates.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    }
    if (rerunTemplateCheckboxesList && allLoadedTemplates.length > 0) {
      rerunTemplateCheckboxesList.innerHTML = allLoadedTemplates.map((t, idx) => `
        <label style="display: flex; align-items: center; gap: 6px; background: var(--bg-surface); padding: 6px 8px; border-radius: 4px; border: 1px solid var(--border-color); cursor: pointer; font-size: 11px;">
          <input type="checkbox" class="chk-rerun-rotate-tpl" value="${t.id}" ${idx < 2 ? 'checked' : ''}>
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(t.name)}</span>
        </label>
      `).join('');
    }

    try {
      const res = await fetch(`/api/campaigns/${campaignId}/preview`);
      const data = await res.json();
      if (!data.ok) { alert(data.error || 'Failed to load campaign preview.'); closeCampaignPreviewModal(); return; }
      const c = data.campaign; const s = data.summary;
      previewModalCampName.textContent = c.name;
      if (rerunCampaignNameInput) rerunCampaignNameInput.value = `${c.name}_Rerun`;

      const senderText = c.sender_email ? `${c.sender_email} (${c.sender_provider})` : '⚡ All Active Pool (Auto-Rotate)';
      previewModalCampMeta.textContent = `Template: ${c.template_name || 'Standard'} | Sender: ${senderText} | Status: ${c.status}`;
      
      const totalCount = s.total || 0;
      const sentCount = s.sent || 0;
      const failedCount = s.failed || 0;
      const queuedCount = (s.queued || 0) + (s.sending || 0);

      previewModalTotal.textContent = totalCount; 
      previewModalSent.textContent = sentCount; 
      previewModalFailed.textContent = failedCount; 
      previewModalQueued.textContent = queuedCount;

      // Smart Scope Auto-Detect
      if (rerunModeSelect) {
        if (failedCount > 0) {
          rerunModeSelect.innerHTML = `
            <option value="failed_only" selected>⚠️ Failed / Errored Contacts Only (${failedCount})</option>
            <option value="all">🔁 All Contacts in Campaign (${totalCount}) (Full Re-run)</option>
          `;
          if (btnToggleRerunDrawer) {
            btnToggleRerunDrawer.textContent = `🔄 Retry ${failedCount} Failed Contacts`;
            btnToggleRerunDrawer.className = 'btn btn-primary btn-sm';
          }
        } else {
          rerunModeSelect.innerHTML = `
            <option value="all" selected>🔁 All Contacts in Campaign (${totalCount}) (Full Re-run)</option>
            <option value="failed_only" disabled>⚠️ Failed Contacts (0 failed)</option>
          `;
        }
      }

      const updateLaunchButtonText = () => {
        if (!btnTriggerRerun) return;
        const mode = rerunModeSelect ? rerunModeSelect.value : 'all';
        const count = mode === 'failed_only' ? failedCount : totalCount;
        btnTriggerRerun.textContent = `🚀 Launch Re-run (${count} Contacts)`;
      };

      if (rerunModeSelect) {
        rerunModeSelect.onchange = updateLaunchButtonText;
      }
      updateLaunchButtonText();

      // Preselect template & sender if present
      if (rerunTemplateSelect && c.template_id) rerunTemplateSelect.value = String(c.template_id);
      if (rerunSenderAccountSelect && c.sender_account_id) rerunSenderAccountSelect.value = String(c.sender_account_id);

      if (!data.sampleItems || data.sampleItems.length === 0) {
        previewModalTableBody.innerHTML = '<tr><td colspan="6" class="table-empty">No queue records found for this campaign.</td></tr>';
      } else {
        previewModalTableBody.innerHTML = data.sampleItems.map(item => {
          let badgeClass = 'badge-queued';
          if (item.status === 'sent') badgeClass = 'badge-completed';
          else if (item.status === 'failed') badgeClass = 'badge-failed';
          else if (item.status === 'sending') badgeClass = 'badge-sending';

          const assignedSenderBadge = item.assigned_sender_email
            ? `<span class="account-badge" style="font-size: 10px;">${escapeHtml(item.assigned_sender_email)}</span>`
            : `<span style="font-size: 11px; color: var(--text-muted);">Pool (Leasing)</span>`;

          const templateVariantBadge = item.template_name
            ? `<span style="font-size: 11px; color: var(--sky); font-weight: 500;">${escapeHtml(item.template_name)}</span>`
            : `<span style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(c.template_name || 'Template')}</span>`;

          return `
            <tr>
              <td><strong>${escapeHtml(item.email)}</strong></td>
              <td>${templateVariantBadge}</td>
              <td>${assignedSenderBadge}</td>
              <td><span class="badge ${badgeClass}">${item.status.toUpperCase()}</span></td>
              <td>${item.attempts || 0}</td>
              <td style="color: ${item.status === 'failed' ? 'var(--rose)' : 'var(--text-muted)'}; font-size: 11px;">${escapeHtml(item.last_error || (item.status === 'sent' ? `Delivered ${formatDateTime(item.sent_at)}` : '--'))}</td>
            </tr>
          `;
        }).join('');
      }
    } catch (err) { alert('Error fetching preview: ' + err.message); closeCampaignPreviewModal(); }
  }

  function closeCampaignPreviewModal() { 
    if (modalCampaignPreview) modalCampaignPreview.style.display = 'none'; 
    activePreviewCampaignId = null; 
  }

  if (btnCloseCampaignPreview) btnCloseCampaignPreview.addEventListener('click', closeCampaignPreviewModal);
  if (btnCancelCampaignPreview) btnCancelCampaignPreview.addEventListener('click', closeCampaignPreviewModal);
  modalCampaignPreview?.addEventListener('click', (e) => { if (e.target === modalCampaignPreview) closeCampaignPreviewModal(); });

  if (btnTriggerRerun) {
    btnTriggerRerun.addEventListener('click', async () => {
      if (!activePreviewCampaignId) return;
      const mode = rerunModeSelect ? rerunModeSelect.value : 'failed_only';
      const newName = rerunCampaignNameInput ? rerunCampaignNameInput.value.trim() : '';

      // Template selection / rotation
      const isRotation = chkRerunTemplateRotation ? chkRerunTemplateRotation.checked : false;
      let templateIds = [];
      let templateId = null;
      if (isRotation) {
        const checked = document.querySelectorAll('.chk-rerun-rotate-tpl:checked');
        if (checked.length < 2) {
          alert('Please select at least 2 templates to enable template rotation.');
          return;
        }
        templateIds = Array.from(checked).map(cb => parseInt(cb.value, 10));
      } else {
        templateId = rerunTemplateSelect ? parseInt(rerunTemplateSelect.value, 10) : null;
      }

      // Sender strategy
      const sendingStrategy = document.querySelector('input[name="rerunStrategyRadio"]:checked')?.value || 'SMART';
      const senderVal = rerunSenderAccountSelect ? rerunSenderAccountSelect.value : '';
      const fallbackAllowed = chkRerunFallbackAllowed ? chkRerunFallbackAllowed.checked : true;

      // Sending speed preset
      const sendingSpeed = document.querySelector('input[name="rerunSpeedPreset"]:checked')?.value || 'BALANCED';
      let customIntervalMs = 2500;
      if (sendingSpeed === 'SAFE') customIntervalMs = 6500;
      else if (sendingSpeed === 'FAST') customIntervalMs = 1000;
      else if (sendingSpeed === 'CUSTOM') {
        customIntervalMs = Math.round(parseFloat(inputRerunCustomIntervalSec?.value || '2.5') * 1000);
      }

      const modeText = mode === 'failed_only' ? 'failed/errored contacts only' : 'all contacts in this campaign';
      const confirmed = confirm(`Are you sure you want to launch this re-run campaign (${modeText})?`);
      if (!confirmed) return;

      btnTriggerRerun.disabled = true;
      btnTriggerRerun.textContent = '⏳ Queuing Re-run...';

      try {
        const payload = {
          newName,
          mode,
          templateId,
          templateIds,
          sendingStrategy,
          senderAccountId: (sendingStrategy === 'CONTROLLED' && senderVal) ? parseInt(senderVal, 10) : null,
          fallbackAllowed,
          sendingSpeed,
          customIntervalMs
        };

        const res = await fetch(`/api/campaigns/${activePreviewCampaignId}/clone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          throw new Error(`Server returned status ${res.status} (${res.statusText}) instead of valid JSON.`);
        }

        const data = await res.json();
        btnTriggerRerun.disabled = false;
        btnTriggerRerun.textContent = '🚀 Launch Re-run Campaign';

        if (data.ok) {
          alert(`🎉 SUCCESS!\n${data.message}`);
          closeCampaignPreviewModal();
          loadCampaigns();
          refreshTelemetry();
          switchTab('tab-overview');
        } else {
          alert(data.error || 'Failed to re-run campaign.');
        }
      } catch (err) {
        btnTriggerRerun.disabled = false;
        btnTriggerRerun.textContent = '🚀 Launch Re-run Campaign';
        alert('Error triggering re-run: ' + err.message);
      }
    });
  }


  function downloadSampleCsv() {
    const csvContent = "Name,email,Paper Title,Affiliation\n" + "Dr. Hamza Memon,checkingm13@gmail.com,Recent Advancements in Machine Learning,World Wide Journals\n" + "Dr. Reeta Shah,editor@paripex.in,Clinical Immunology & Public Health,Medical Research Institute\n" + "Dr. Sharma,author@example.com,Quantum Computing Applications,Indian Science Academy\n";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url); link.setAttribute('download', 'contacts_sample.csv');
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  }

  const cardActionLaunch = document.getElementById('cardActionLaunch');
  const cardActionTest = document.getElementById('cardActionTest');
  const cardActionSampleCsv = document.getElementById('cardActionSampleCsv');
  const btnDownloadSampleCsvInner = document.getElementById('btnDownloadSampleCsvInner');
  cardActionLaunch?.addEventListener('click', () => switchTab('tab-campaigns'));
  cardActionTest?.addEventListener('click', openQuickTestModal);
  cardActionSampleCsv?.addEventListener('click', downloadSampleCsv);
  btnDownloadSampleCsvInner?.addEventListener('click', downloadSampleCsv);

  // Initial Boot (Async Lazy Loading: Only load active Overview tab immediately)
  refreshTelemetry();
  loadAccounts();
  loadQueue();

  // 3s Telemetry Loop (Lightweight status check; only refreshes active view)
  setInterval(() => {
    refreshTelemetry();
    const activeTab = document.querySelector('.nav-tab.active')?.dataset.tab;
    if (activeTab === 'tab-overview') {
      loadAccounts();
    }
  }, 3000);
});
