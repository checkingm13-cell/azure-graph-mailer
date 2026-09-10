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

  let isWorkerPaused = false;
  let allLoadedTemplates = [];
  let currentPreviewData = null;
  let selectedFile = null;

  // 1. TAB NAVIGATION
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const targetId = tab.dataset.tab;
      document.getElementById(targetId)?.classList.add('active');

      if (targetId === 'tab-accounts') loadAccounts();
      if (targetId === 'tab-templates') loadTemplates();
      if (targetId === 'tab-campaigns') { loadTemplates(); loadCampaigns(); }
      if (targetId === 'tab-contacts') loadContacts();
      if (targetId === 'tab-logs') loadLogs();
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

    } catch (_) {}
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

    batchesListContainer.innerHTML = '';
    for (let i = 0; i < totalBatches; i++) {
      const start = i * size;
      const count = Math.min(size, contacts.length - start);
      const batchNumStr = String(i + 1).padStart(2, '0');
      const batchName = `${baseName}_Batch_${batchNumStr}`;

      batchesListContainer.innerHTML += `
        <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; font-size: 12px;">
          <div style="font-weight: 600; color: var(--sky);">${escapeHtml(batchName)}</div>
          <div style="color: var(--text-muted); margin-top: 4px;">👥 <strong>${count}</strong> recipients queued</div>
        </div>
      `;
    }

    btnConfirmLaunchBatches.textContent = `🚀 Confirm & Launch All ${totalBatches} Batches (${contacts.length} Total Emails)`;
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
      btnConfirmLaunchBatches.textContent = '⏳ Creating Campaigns & Populating 24/7 Queue...';

      const payload = {
        baseCampaignName: batchBaseCampaignName.value.trim() || currentPreviewData.baseCampaignName,
        templateId: parseInt(templateId, 10),
        batchSize: parseInt(batchSizeInput.value || '50', 10),
        skipPreviouslyContacted: chkSkipPreviouslyContacted.checked,
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
          alert(`🎉 SUCCESS! Created ${data.totalCampaigns} campaign batches with ${data.totalQueued} emails queued!\n\nThe 24/7 background worker is now dispatching them sequentially across your sender accounts.`);
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
        campaignsTableBody.innerHTML = `<tr><td colspan="5" class="table-empty">No campaigns executed yet.</td></tr>`;
      } else {
        campaignsTableBody.innerHTML = data.campaigns.map((c) => `
          <tr>
            <td>#${c.id}</td>
            <td><strong>${escapeHtml(c.name)}</strong></td>
            <td>${escapeHtml(c.template_name || '--')}</td>
            <td><span class="badge ${c.status === 'COMPLETED' ? 'badge-completed' : 'badge-queued'}">${c.status}</span></td>
            <td>${c.sent_count} / ${c.total_count} (${c.failed_count} failed)</td>
          </tr>
        `).join('');
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
