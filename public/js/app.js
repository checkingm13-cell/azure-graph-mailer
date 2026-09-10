/**
 * Frontend Application Controller for Azure Multi-Account Mailer
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const workerStateBadge = document.getElementById('workerStateBadge');
  const workerStatusText = document.getElementById('workerStatusText');
  const btnToggleWorker = document.getElementById('btnToggleWorker');

  const statActiveAccounts = document.getElementById('statActiveAccounts');
  const statTotalAccounts = document.getElementById('statTotalAccounts');
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

  const campTemplateSelect = document.getElementById('campTemplateSelect');
  const formCreateCampaign = document.getElementById('formCreateCampaign');
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

  let isWorkerPaused = false;
  let allLoadedTemplates = [];
  let currentPreviewData = null;
  let selectedFile = null;

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

  // 1. TAB NAVIGATION
  function switchTab(targetId) {
    document.querySelectorAll('.nav-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));

    const tabBtn = document.querySelector(`.nav-tab[data-tab="${targetId}"]`);
    if (tabBtn) tabBtn.classList.add('active');
    document.getElementById(targetId)?.classList.add('active');

    if (targetId === 'tab-accounts') loadAccounts();
    if (targetId === 'tab-templates') loadTemplates();
    if (targetId === 'tab-campaigns') { loadTemplates(); loadCampaigns(); }
    if (targetId === 'tab-contacts') loadContacts();
    if (targetId === 'tab-logs') loadLogs();
  }

  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
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

      // Pool summary
      statActiveAccounts.textContent = `${pool.active_accounts || 0} / ${pool.total_accounts || 0}`;
      statTotalAccounts.textContent = `${pool.total_accounts || 0} registered accounts`;

      statDailyCapacity.textContent = `${pool.total_daily_capacity || 0}`;
      statSentToday.textContent = `${pool.total_sent_today || 0} sent today (${pool.total_remaining_today || 0} remaining)`;

      statQueuePending.textContent = worker.queue.queued;
      statQueueSending.textContent = `${worker.queue.sending} currently in transit`;

      badgeQueueTotal.textContent = `${worker.queue.queued} waiting`;

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
            if (btnMonitorPause) {
              btnMonitorPause.style.display = 'inline-block';
              btnMonitorPause.dataset.id = activeCamp.id;
            }
            if (btnMonitorResume) btnMonitorResume.style.display = 'none';
            if (btnMonitorCancel) {
              btnMonitorCancel.style.display = 'inline-block';
              btnMonitorCancel.dataset.id = activeCamp.id;
            }

            if (activeCamp.etaSeconds > 0) {
              monitorEtaText.textContent = activeCamp.etaSeconds < 60 
                ? `~${activeCamp.etaSeconds}s remaining` 
                : `~${Math.ceil(activeCamp.etaSeconds / 60)} min remaining`;
            } else {
              monitorEtaText.textContent = 'Finishing batch...';
            }
          } else if (activeCamp.status === 'PAUSED') {
            monitorStatusBadge.className = 'badge badge-paused';
            monitorStatusBadge.textContent = '⏸️ PAUSED';
            if (btnMonitorPause) btnMonitorPause.style.display = 'none';
            if (btnMonitorResume) {
              btnMonitorResume.style.display = 'inline-block';
              btnMonitorResume.dataset.id = activeCamp.id;
            }
            if (btnMonitorCancel) {
              btnMonitorCancel.style.display = 'inline-block';
              btnMonitorCancel.dataset.id = activeCamp.id;
            }
            monitorEtaText.textContent = 'Paused by user';
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
          if (btnMonitorCancel) {
            btnMonitorCancel.style.display = 'inline-block';
            btnMonitorCancel.dataset.id = nextCamp.id;
          }
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

    } catch (_) {}
  }

  // Monitor Hero Buttons
  if (btnMonitorPause) {
    btnMonitorPause.addEventListener('click', async () => {
      const campId = btnMonitorPause.dataset.id;
      if (!campId) return;
      await fetch(`/api/campaigns/${campId}/pause`, { method: 'POST' });
      refreshTelemetry();
      loadCampaigns();
    });
  }

  if (btnMonitorResume) {
    btnMonitorResume.addEventListener('click', async () => {
      const campId = btnMonitorResume.dataset.id;
      if (!campId) return;
      await fetch(`/api/campaigns/${campId}/resume`, { method: 'POST' });
      refreshTelemetry();
      loadCampaigns();
    });
  }

  if (btnMonitorCancel) {
    btnMonitorCancel.addEventListener('click', async () => {
      const campId = btnMonitorCancel.dataset.id;
      if (!campId) return;
      if (!confirm('Cancel this batch? Remaining queued emails will not be sent.')) return;
      await fetch(`/api/campaigns/${campId}/cancel`, { method: 'POST' });
      refreshTelemetry();
      loadCampaigns();
    });
  }

  // Worker Toggle Button
  btnToggleWorker.addEventListener('click', async () => {
    const endpoint = isWorkerPaused ? '/api/worker/resume' : '/api/worker/pause';
    await fetch(endpoint, { method: 'POST' });
    await refreshTelemetry();
  });

  // 4. LOAD ACCOUNTS POOL
  async function loadAccounts() {
    try {
      const res = await fetch('/api/accounts');
      const data = await res.json();
      if (!data.ok) return;

      badgeAccountCount.textContent = `${data.accounts.length} accounts`;

      // Render Table in Accounts tab
      if (data.accounts.length === 0) {
        accountsTableBody.innerHTML = `<tr><td colspan="5" class="table-empty">No sender accounts registered yet.</td></tr>`;
      } else {
        accountsTableBody.innerHTML = data.accounts.map((a) => `
          <tr>
            <td>
              <strong>${escapeHtml(a.email)}</strong>
              <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(a.display_name)}</div>
            </td>
            <td><span class="account-badge">${a.provider}</span></td>
            <td>${a.sent_today} / ${a.daily_limit}</td>
            <td>${a.cooldown_seconds}s</td>
            <td>
              <button class="btn btn-danger btn-sm btn-del-account" data-id="${a.id}">Delete</button>
            </td>
          </tr>
        `).join('');

        document.querySelectorAll('.btn-del-account').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!confirm('Remove this sender account from pool?')) return;
            await fetch(`/api/accounts/${btn.dataset.id}`, { method: 'DELETE' });
            loadAccounts();
            refreshTelemetry();
          });
        });
      }

      // Render Accounts Grid in Overview tab
      if (data.accounts.length === 0) {
        accountsPoolGrid.innerHTML = `<div class="loading-placeholder">No accounts registered. Go to "Sender Accounts Pool" tab to add your first account.</div>`;
      } else {
        accountsPoolGrid.innerHTML = data.accounts.map((a) => {
          const pct = Math.min(100, Math.round((a.sent_today / a.daily_limit) * 100));
          const isCooldown = a.cooldown_remaining_sec > 0;
          return `
            <div class="account-card">
              <div class="account-card-header">
                <div>
                  <div class="account-email">${escapeHtml(a.email)}</div>
                  <div style="font-size: 10px; color: var(--text-muted);">${escapeHtml(a.display_name)}</div>
                </div>
                <span class="account-badge">${a.provider}</span>
              </div>
              <div class="gauge-bar-bg">
                <div class="gauge-bar-fill" style="width: ${pct}%; background-color: ${pct > 90 ? 'var(--rose)' : 'var(--emerald)'};"></div>
              </div>
              <div class="account-stats-row">
                <span>Quota: ${a.sent_today} / ${a.daily_limit}</span>
                <span>${isCooldown ? `⏳ Cooldown: ${a.cooldown_remaining_sec}s` : '🟢 Ready'}</span>
              </div>
            </div>
          `;
        }).join('');
      }

    } catch (err) {
      console.error('Error loading accounts:', err);
    }
  }

  // Add Account Form
  formAddAccount.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      email: document.getElementById('accEmail').value.trim(),
      displayName: document.getElementById('accDisplayName').value.trim(),
      dailyLimit: document.getElementById('accDailyLimit').value,
      cooldownSeconds: document.getElementById('accCooldown').value,
      provider: document.getElementById('accProvider').value
    };

    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.ok) {
      formAddAccount.reset();
      loadAccounts();
      refreshTelemetry();
    } else {
      alert(data.error || 'Failed to add account');
    }
  });

  // 5. TEMPLATES
  async function loadTemplates() {
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      if (!data.ok) return;

      allLoadedTemplates = data.templates || [];

      // Dropdown in Campaigns Tab
      const tplOptions = `<option value="">-- Choose Template --</option>` +
        allLoadedTemplates.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');

      if (document.getElementById('campTemplateSelect')) {
        document.getElementById('campTemplateSelect').innerHTML = tplOptions;
      }
      const batchTplSelect = document.getElementById('batchTemplateSelect');
      if (batchTplSelect) {
        batchTplSelect.innerHTML = tplOptions;
      }

      // Grid in Templates Tab
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
            tplId.value = t.id;
            tplName.value = t.name;
            tplSubject.value = t.subject;
            tplBody.value = t.body_html;
            window.scrollTo({ top: 0, behavior: 'smooth' });
          });
        });

        document.querySelectorAll('.btn-delete-tpl').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to delete this email template?')) return;
            const res = await fetch(`/api/templates/${btn.dataset.id}`, { method: 'DELETE' });
            const result = await res.json();
            if (result.ok) {
              loadTemplates();
            } else {
              alert(result.error || 'Failed to delete template');
            }
          });
        });
      }

    } catch (_) {}
  }

  formTemplate.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      id: tplId.value || null,
      name: tplName.value.trim(),
      subject: tplSubject.value.trim(),
      bodyHtml: tplBody.value.trim()
    };

    const res = await fetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.ok) {
      formTemplate.reset();
      tplId.value = '';
      loadTemplates();
      alert('Template saved successfully!');
    } else {
      alert(data.error || 'Failed to save template');
    }
  });

  btnResetTemplate.addEventListener('click', () => {
    formTemplate.reset();
    tplId.value = '';
  });

  // 6. CSV CONTACT UPLOAD
  dropZone.addEventListener('click', () => csvFileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  csvFileInput.addEventListener('change', () => {
    if (csvFileInput.files.length > 0) {
      handleFileSelected(csvFileInput.files[0]);
    }
  });

  function handleFileSelected(file) {
    const isSupported = /\.(csv|xlsx|xls)$/i.test(file.name);
    if (!isSupported) {
      alert('Please select a valid Excel (.xlsx, .xls) or CSV (.csv) spreadsheet file');
      return;
    }
    selectedFile = file;
    selectedFileName.textContent = `Selected: ${file.name} (${Math.round(file.size / 1024)} KB)`;
    btnUploadCsv.disabled = false;
  }

  formUploadCsv.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedFile) return;

    btnUploadCsv.disabled = true;
    btnUploadCsv.textContent = '⏳ Parsing & Importing...';

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const res = await fetch('/api/contacts/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.ok) {
        alert(`Successfully imported ${data.imported} contacts! (${data.skipped} skipped/invalid)`);
        selectedFile = null;
        selectedFileName.textContent = '';
        btnUploadCsv.textContent = '📥 Parse & Save Contacts';
        loadContacts();
      } else {
        alert(data.error || 'Failed to upload CSV');
        btnUploadCsv.disabled = false;
        btnUploadCsv.textContent = '📥 Parse & Save Contacts';
      }
    } catch (err) {
      alert('Error uploading file: ' + err.message);
      btnUploadCsv.disabled = false;
      btnUploadCsv.textContent = '📥 Parse & Save Contacts';
    }
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
          <tr>
            <td><strong>${escapeHtml(c.email)}</strong></td>
            <td>${escapeHtml(c.name || '--')}</td>
            <td>${escapeHtml(c.paper_title || '--')}</td>
            <td><span class="badge badge-completed">${c.status}</span></td>
          </tr>
        `).join('');
      }
    } catch (_) {}
  }

  // 7. AUTO-SPLIT CSV CAMPAIGN WIZARD WITH PRE-FLIGHT PREVIEW
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
      e.preventDefault();
      campaignDropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleCampaignFileSelected(e.dataTransfer.files[0]);
      }
    });

    campaignCsvFileInput.addEventListener('change', () => {
      if (campaignCsvFileInput.files.length > 0) {
        handleCampaignFileSelected(campaignCsvFileInput.files[0]);
      }
    });
  }

  if (btnCancelPreview) {
    btnCancelPreview.addEventListener('click', () => {
      currentPreviewData = null;
      campaignPreFlightBox.style.display = 'none';
      campaignDropZone.style.display = 'block';
      if (campaignCsvFileInput) campaignCsvFileInput.value = '';
    });
  }

  async function handleCampaignFileSelected(file) {
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
      alert('Please upload a valid CSV or spreadsheet file (.csv, .xlsx, .xls)');
      return;
    }

    campaignPreviewLoading.style.display = 'block';
    campaignPreFlightBox.style.display = 'none';

    const formData = new FormData();
    formData.append('file', file);
    formData.append('batchSize', batchSizeInput ? batchSizeInput.value || 50 : 50);

    try {
      const res = await fetch('/api/campaigns/preview-upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      campaignPreviewLoading.style.display = 'none';

      if (!data.ok) {
        alert(data.error || 'Failed to parse file for preview.');
        return;
      }

      currentPreviewData = data;
      renderPreFlightPreview();
    } catch (err) {
      campaignPreviewLoading.style.display = 'none';
      alert('Error analyzing CSV preview: ' + err.message);
    }
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
    renderBatchesBreakdown();
    updateSampleEmailPreview();
  }

  function renderBatchesBreakdown() {
    if (!currentPreviewData) return;

    const size = Math.max(1, parseInt(batchSizeInput.value || '50', 10));
    const skip = chkSkipPreviouslyContacted.checked;
    let contacts = currentPreviewData.contacts;
    if (skip) {
      contacts = contacts.filter((c) => !c.previouslyContacted);
    }

    const totalBatches = Math.ceil(contacts.length / size) || 1;
    const baseName = batchBaseCampaignName.value.trim() || currentPreviewData.baseCampaignName;
    const mode = campaignScheduleMode ? campaignScheduleMode.value : 'immediate';
    const startTimeVal = campaignScheduledStartTime ? campaignScheduledStartTime.value : '';
    const staggerMins = Math.max(1, parseInt(campaignStaggerMinutes ? campaignStaggerMinutes.value || '60' : '60', 10));

    let baseMs = Date.now();
    if (startTimeVal && (mode === 'scheduled' || mode === 'staggered')) {
      const parsed = new Date(startTimeVal).getTime();
      if (!isNaN(parsed) && parsed > Date.now()) {
        baseMs = parsed;
      }
    }

    batchesListContainer.innerHTML = '';
    for (let i = 0; i < totalBatches; i++) {
      const start = i * size;
      const count = Math.min(size, contacts.length - start);
      const batchNumStr = String(i + 1).padStart(2, '0');
      const batchName = `${baseName}_Batch_${batchNumStr}`;

      let startMs = baseMs;
      if (mode === 'staggered') {
        startMs = baseMs + i * (staggerMins * 60 * 1000);
      } else if (mode === 'scheduled') {
        startMs = baseMs + i * 2000;
      } else {
        startMs = Date.now() + i * 2000;
      }

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

  function updateSampleEmailPreview() {
    if (!currentPreviewData || !currentPreviewData.contacts.length) return;

    const templateId = batchTemplateSelect.value;
    const firstContact = currentPreviewData.contacts[0];
    sampleRecipientEmail.textContent = `Recipient: ${firstContact.email} (${firstContact.name || 'Author'})`;

    if (!templateId) {
      sampleSubjectLine.textContent = 'Subject: (Choose a template above)';
      sampleEmailBody.innerHTML = 'Choose a template above to preview how the email will look with merged variables.';
      return;
    }

    const template = allLoadedTemplates.find((t) => String(t.id) === String(templateId));
    if (!template) return;

    function merge(str, c) {
      return (str || '')
        .replace(/\{\{\s*Name\s*\}\}/gi, c.name || 'Dr. Researcher')
        .replace(/\{\{\s*Paper\s*Title\s*\}\}/gi, c.paper_title || 'Recent Scientific Advances')
        .replace(/\{\{\s*Affiliation\s*\}\}/gi, c.affiliation || 'University Department')
        .replace(/\{\{\s*Date\s*\}\}/gi, new Date().toLocaleDateString());
    }

    sampleSubjectLine.textContent = `Subject: ${merge(template.subject, firstContact)}`;
    sampleEmailBody.innerHTML = merge(template.body_html, firstContact);
  }

  if (batchSizeInput) {
    batchSizeInput.addEventListener('input', renderBatchesBreakdown);
  }
  if (batchBaseCampaignName) {
    batchBaseCampaignName.addEventListener('input', renderBatchesBreakdown);
  }
  if (chkSkipPreviouslyContacted) {
    chkSkipPreviouslyContacted.addEventListener('change', renderBatchesBreakdown);
  }
  if (batchTemplateSelect) {
    batchTemplateSelect.addEventListener('change', updateSampleEmailPreview);
  }

  // Scheduling Mode Change Listener
  if (campaignScheduleMode) {
    campaignScheduleMode.addEventListener('change', () => {
      const mode = campaignScheduleMode.value;
      if (mode === 'scheduled') {
        groupScheduledStartTime.style.display = 'block';
        groupStaggerInterval.style.display = 'none';
        if (!campaignScheduledStartTime.value) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(9, 0, 0, 0);
          campaignScheduledStartTime.value = tomorrow.toISOString().slice(0, 16);
        }
      } else if (mode === 'staggered') {
        groupScheduledStartTime.style.display = 'block';
        groupStaggerInterval.style.display = 'block';
        if (!campaignScheduledStartTime.value) {
          const now = new Date();
          campaignScheduledStartTime.value = now.toISOString().slice(0, 16);
        }
      } else {
        groupScheduledStartTime.style.display = 'none';
        groupStaggerInterval.style.display = 'none';
      }
      renderBatchesBreakdown();
    });
  }

  if (campaignScheduledStartTime) {
    campaignScheduledStartTime.addEventListener('input', renderBatchesBreakdown);
  }
  if (campaignStaggerMinutes) {
    campaignStaggerMinutes.addEventListener('input', renderBatchesBreakdown);
  }

  if (formLaunchBatches) {
    formLaunchBatches.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentPreviewData) return;

      const templateId = batchTemplateSelect.value;
      if (!templateId) {
        alert('Please select an Email Template to apply across all batches.');
        return;
      }

      btnConfirmLaunchBatches.disabled = true;
      btnConfirmLaunchBatches.textContent = '⏳ Creating Campaigns & Scheduling Queue...';

      const payload = {
        baseCampaignName: batchBaseCampaignName.value.trim() || currentPreviewData.baseCampaignName,
        templateId: parseInt(templateId, 10),
        batchSize: parseInt(batchSizeInput.value || '50', 10),
        skipPreviouslyContacted: chkSkipPreviouslyContacted.checked,
        scheduleMode: campaignScheduleMode ? campaignScheduleMode.value : 'immediate',
        scheduledStartTime: campaignScheduledStartTime ? campaignScheduledStartTime.value : '',
        staggerMinutes: parseInt(campaignStaggerMinutes ? campaignStaggerMinutes.value || '60' : '60', 10),
        contacts: currentPreviewData.contacts
      };

      try {
        const res = await fetch('/api/campaigns/launch-batches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        btnConfirmLaunchBatches.disabled = false;

        if (data.ok) {
          alert(`🎉 SUCCESS! Created ${data.totalCampaigns} campaign batches with ${data.totalQueued} emails queued!\n\nMode: ${data.scheduleMode.toUpperCase()}. The background scheduler will dispatch each batch right on time.`);
          campaignPreFlightBox.style.display = 'none';
          currentPreviewData = null;
          if (campaignCsvFileInput) campaignCsvFileInput.value = '';
          loadCampaigns();
          refreshTelemetry();
          document.querySelector('.nav-tab[data-tab="tab-overview"]').click();
        } else {
          alert(data.error || 'Failed to launch batches.');
        }
      } catch (err) {
        btnConfirmLaunchBatches.disabled = false;
        alert('Error launching campaigns: ' + err.message);
      }
    });
  }

  async function loadCampaigns() {
    try {
      const res = await fetch('/api/campaigns');
      const data = await res.json();
      if (!data.ok) return;

      if (data.campaigns.length === 0) {
        campaignsTableBody.innerHTML = `<tr><td colspan="7" class="table-empty">No campaigns executed yet.</td></tr>`;
      } else {
        campaignsTableBody.innerHTML = data.campaigns.map((c) => {
          let statusBadgeClass = 'badge-queued';
          if (c.status === 'COMPLETED') statusBadgeClass = 'badge-completed';
          else if (c.status === 'RUNNING') statusBadgeClass = 'badge-sending';
          else if (c.status === 'PAUSED') statusBadgeClass = 'badge-paused';
          else if (c.status === 'SCHEDULED') statusBadgeClass = 'badge-scheduled';
          else if (c.status === 'CANCELLED') statusBadgeClass = 'badge-cancelled';

          let actionsHtml = '';
          if (c.status === 'RUNNING') {
            actionsHtml = `
              <button type="button" class="btn btn-secondary btn-sm btn-pause-camp" data-id="${c.id}" style="padding: 3px 8px; font-size: 11px;">Pause</button>
              <button type="button" class="btn btn-danger btn-sm btn-cancel-camp" data-id="${c.id}" style="padding: 3px 8px; font-size: 11px;">Cancel</button>
            `;
          } else if (c.status === 'PAUSED') {
            actionsHtml = `
              <button type="button" class="btn btn-primary btn-sm btn-resume-camp" data-id="${c.id}" style="padding: 3px 8px; font-size: 11px;">Resume</button>
              <button type="button" class="btn btn-danger btn-sm btn-cancel-camp" data-id="${c.id}" style="padding: 3px 8px; font-size: 11px;">Cancel</button>
            `;
          } else if (c.status === 'SCHEDULED' || c.status === 'QUEUED') {
            actionsHtml = `
              <button type="button" class="btn btn-danger btn-sm btn-cancel-camp" data-id="${c.id}" style="padding: 3px 8px; font-size: 11px;">Cancel</button>
            `;
          } else {
            actionsHtml = `
              <button type="button" class="btn btn-secondary btn-sm btn-clone-camp" data-id="${c.id}" data-name="${escapeHtml(c.name)}" style="padding: 3px 8px; font-size: 11px; background: rgba(56, 189, 248, 0.15); border-color: rgba(56, 189, 248, 0.4); color: var(--sky);">🔄 Re-run / Clone</button>
            `;
          }

          const timeDisplay = c.started_at 
            ? `Started: ${formatDateTime(c.started_at)}` 
            : (c.scheduled_at ? `Scheduled: ${formatDateTime(c.scheduled_at)}` : '--');

          return `
            <tr>
              <td>#${c.id}</td>
              <td><strong>${escapeHtml(c.name)}</strong></td>
              <td>${escapeHtml(c.template_name || '--')}</td>
              <td><span style="font-size: 11px; color: var(--text-secondary);">${timeDisplay}</span></td>
              <td><span class="badge ${statusBadgeClass}">${c.status}</span></td>
              <td>${c.sent_count} / ${c.total_count} ${c.failed_count > 0 ? `<span style="color: var(--rose);">(${c.failed_count} err)</span>` : ''}</td>
              <td>${actionsHtml}</td>
            </tr>
          `;
        }).join('');

        // Wire Action buttons
        campaignsTableBody.querySelectorAll('.btn-clone-camp').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const campId = btn.dataset.id;
            const campName = btn.dataset.name;
            const confirmed = confirm(`🔄 Re-run / Clone Campaign "${campName}"?\n\nThis will take the contacts from this campaign and queue a new dispatch run without needing to re-upload the CSV file.`);
            if (!confirmed) return;

            btn.disabled = true;
            btn.textContent = '⏳ Queuing...';

            try {
              const res = await fetch(`/api/campaigns/${campId}/clone`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode: 'all' })
              });
              const data = await res.json();
              if (data.ok) {
                alert(`🎉 SUCCESS!\n\n${data.message}`);
                loadCampaigns();
                refreshTelemetry();
                switchTab('tab-overview');
              } else {
                alert(data.error || 'Failed to re-run campaign.');
                btn.disabled = false;
                btn.textContent = '🔄 Re-run';
              }
            } catch (err) {
              alert('Error re-running campaign: ' + err.message);
              btn.disabled = false;
              btn.textContent = '🔄 Re-run';
            }
          });
        });

        campaignsTableBody.querySelectorAll('.btn-pause-camp').forEach((btn) => {
          btn.addEventListener('click', async () => {
            await fetch(`/api/campaigns/${btn.dataset.id}/pause`, { method: 'POST' });
            loadCampaigns();
            refreshTelemetry();
          });
        });

        campaignsTableBody.querySelectorAll('.btn-resume-camp').forEach((btn) => {
          btn.addEventListener('click', async () => {
            await fetch(`/api/campaigns/${btn.dataset.id}/resume`, { method: 'POST' });
            loadCampaigns();
            refreshTelemetry();
          });
        });

        campaignsTableBody.querySelectorAll('.btn-cancel-camp').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (!confirm('Cancel this campaign? Any unsent emails will be stopped.')) return;
            await fetch(`/api/campaigns/${btn.dataset.id}/cancel`, { method: 'POST' });
            loadCampaigns();
            refreshTelemetry();
          });
        });
      }
    } catch (_) {}
  }

  // 8. AUDIT LOGS
  async function loadLogs() {
    try {
      const res = await fetch('/api/logs?limit=100');
      const data = await res.json();
      if (!data.ok) return;

      if (data.logs.length === 0) {
        terminalLogs.innerHTML = `<div class="terminal-line">[LOG] No activity logs recorded yet.</div>`;
      } else {
        terminalLogs.innerHTML = data.logs.map((l) => {
          const color = l.level === 'ERROR' ? 'var(--rose)' : (l.level === 'WARN' ? 'var(--amber)' : 'var(--emerald)');
          return `
            <div class="terminal-line">
              <span style="color: var(--text-muted);">${new Date(l.timestamp).toLocaleTimeString()}</span>
              <span style="color: ${color}; font-weight: 600;">[${l.level}]</span>
              ${l.sender_email ? `<span style="color: var(--sky);">[${l.sender_email}]</span>` : ''}
              <span>${escapeHtml(l.message)}</span>
            </div>
          `;
        }).join('');
      }
    } catch (_) {}
  }

  btnRefreshLogs.addEventListener('click', loadLogs);

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  // 9. QUICK ACTIONS & QUICK TEST MODAL (Zero-Brain Experience)
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
    quickTestResult.style.display = 'none';
    modalQuickTest.style.display = 'flex';
    if (quickTestToEmail) quickTestToEmail.focus();
  }

  function closeQuickTestModal() {
    if (modalQuickTest) modalQuickTest.style.display = 'none';
  }

  if (btnOpenQuickTest) btnOpenQuickTest.addEventListener('click', openQuickTestModal);
  if (btnCloseQuickTest) btnCloseQuickTest.addEventListener('click', closeQuickTestModal);
  if (btnCancelQuickTest) btnCancelQuickTest.addEventListener('click', closeQuickTestModal);

  modalQuickTest?.addEventListener('click', (e) => {
    if (e.target === modalQuickTest) closeQuickTestModal();
  });

  formQuickTest?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const toEmail = quickTestToEmail.value.trim();
    const name = quickTestName.value.trim();
    const subject = quickTestSubject.value.trim();

    btnSubmitQuickTest.disabled = true;
    btnSubmitQuickTest.textContent = '⏳ Dispatching...';
    quickTestResult.style.display = 'none';

    try {
      const res = await fetch('/api/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toEmail, name, subject })
      });
      const data = await res.json();
      quickTestResult.style.display = 'block';

      if (data.ok) {
        quickTestResult.style.background = 'rgba(16, 185, 129, 0.15)';
        quickTestResult.style.color = 'var(--emerald)';
        quickTestResult.style.border = '1px solid rgba(16, 185, 129, 0.4)';
        quickTestResult.innerHTML = `✅ <b>Dispatched!</b> ${escapeHtml(data.message)}<br/><span style="font-size: 11px;">Message handed to Microsoft Graph API. Check recipient inbox/spam.</span>`;
        refreshTelemetry();
      } else {
        quickTestResult.style.background = 'rgba(244, 63, 94, 0.15)';
        quickTestResult.style.color = 'var(--rose)';
        quickTestResult.style.border = '1px solid rgba(244, 63, 94, 0.4)';
        quickTestResult.innerHTML = `❌ <b>Error:</b> ${escapeHtml(data.error)}`;
      }
    } catch (err) {
      quickTestResult.style.display = 'block';
      quickTestResult.style.background = 'rgba(244, 63, 94, 0.15)';
      quickTestResult.style.color = 'var(--rose)';
      quickTestResult.style.border = '1px solid rgba(244, 63, 94, 0.4)';
      quickTestResult.innerHTML = `❌ <b>Network error:</b> ${escapeHtml(err.message)}`;
    } finally {
      btnSubmitQuickTest.disabled = false;
      btnSubmitQuickTest.textContent = '🚀 Send Test Now';
    }
  });

  function downloadSampleCsv() {
    const csvContent = "Name,email,Paper Title,Affiliation\n" +
      "Dr. Hamza Memon,checkingm13@gmail.com,Recent Advancements in Machine Learning,World Wide Journals\n" +
      "Dr. Reeta Shah,editor@paripex.in,Clinical Immunology & Public Health,Medical Research Institute\n" +
      "Dr. Sharma,author@example.com,Quantum Computing Applications,Indian Science Academy\n";

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'contacts_sample.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Quick Action Cards
  const cardActionLaunch = document.getElementById('cardActionLaunch');
  const cardActionTest = document.getElementById('cardActionTest');
  const cardActionSampleCsv = document.getElementById('cardActionSampleCsv');
  const btnDownloadSampleCsvInner = document.getElementById('btnDownloadSampleCsvInner');

  cardActionLaunch?.addEventListener('click', () => switchTab('tab-campaigns'));
  cardActionTest?.addEventListener('click', openQuickTestModal);
  cardActionSampleCsv?.addEventListener('click', downloadSampleCsv);
  btnDownloadSampleCsvInner?.addEventListener('click', downloadSampleCsv);

  // Initial Boot
  refreshTelemetry();
  loadAccounts();
  loadContacts();
  loadTemplates();

  // 3s Telemetry Loop
  setInterval(() => {
    refreshTelemetry();
    const activeTab = document.querySelector('.nav-tab.active')?.dataset.tab;
    if (activeTab === 'tab-overview') loadAccounts();
    if (activeTab === 'tab-logs') loadLogs();
  }, 3000);

});
