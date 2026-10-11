export const attachmentStyles = `
  .file-list { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; padding: 0; list-style: none; min-width: 0; }
  .file-card { display: flex; gap: 10px; align-items: center; border: 1px solid var(--line); background: var(--surface); border-radius: 6px; padding: 8px 10px; min-width: 0; width: 280px; max-width: 100%; }
  .file-card > div { flex: 1; min-width: 0; }
  .file-card a { color: var(--text); text-decoration: none; }
  .file-card a:hover { text-decoration: underline; }
  .file-name { display: block; overflow-wrap: anywhere; font-size: 13px; line-height: 1.4; }
  .file-meta { display: block; color: var(--muted); font-size: 12px; margin-top: 3px; overflow-wrap: anywhere; }
  .file-ext { display: grid; place-items: center; width: 36px; height: 40px; flex: 0 0 36px; color: var(--cyan); background: var(--cyan-soft); border-radius: 4px; font: 600 10px monospace; }
  .file-card .icon-btn { flex: 0 0 32px; }
  .file-card.failed { border-color: var(--red, #e66d72); }
  .file-card.failed .file-meta { color: var(--red, #e66d72); }
  .file-preview { display: block; max-width: 360px; margin-top: 8px; }
  .file-preview img { display: block; width: 100%; height: 180px; object-fit: contain; background: var(--surface-2); border: 1px solid var(--line); border-radius: 6px; }
  #chat-draft-files { padding: 0 10px; max-height: 170px; overflow-y: auto; }
  #chat-draft-files:empty { display: none; }
  .human-chat.file-dragging .composer-box { outline: 2px solid var(--cyan); outline-offset: 2px; }
  @media (max-width: 500px) { .file-card { width: 100%; } .file-preview { max-width: 100%; } }
`;

export const attachmentScript = String.raw`
  function hasChatDraft() { return Boolean(chatContent.value.trim() || chat.files.length); }
  function fileSize(size) { return size < 1024 ? size + ' B' : size < 1048576 ? (size / 1024).toFixed(1) + ' KB' : (size / 1048576).toFixed(1) + ' MB'; }
  function fileExt(name) { return String(name).includes('.') ? String(name).split('.').pop().slice(0, 6).toUpperCase() : 'FILE'; }
  function safeFileUrl(file) {
    const expected = '/api/workspaces/' + encodeURIComponent(currentSlug()) + '/files/';
    return typeof file.url === 'string' && file.url.startsWith(expected) && /^[a-f0-9-]{36}$/.test(file.url.slice(expected.length)) ? file.url : '';
  }
  function messageAttachments(files) {
    if (!Array.isArray(files)) return '';
    return files.map(file => {
      const url = safeFileUrl(file); if (!url) return '';
      return (['image/png','image/jpeg','image/gif','image/webp'].includes(file.content_type)
        ? '<a class="file-preview" href="' + url + '?preview=1" target="_blank" rel="noopener" aria-label="Open image ' + escapeHtml(file.name) + '"><img loading="lazy" src="' + url + '?preview=1" alt="' + escapeHtml(file.name) + '"></a>' : '') +
        '<div class="file-list"><div class="file-card"><span class="file-ext" aria-hidden="true">' + escapeHtml(fileExt(file.name)) + '</span><div><a class="file-name" href="' + url + '" download>' + escapeHtml(file.name) + '</a><span class="file-meta">' + fileSize(file.size) + '</span></div><a class="icon-btn" href="' + url + '" download aria-label="Download ' + escapeHtml(file.name) + '" title="Download">' + ICONS.arrowDown + '</a></div></div>';
    }).join('');
  }
  function renderDraftFiles() {
    const target = document.getElementById('chat-draft-files');
    target.innerHTML = chat.files.map(file => '<li class="file-card' + (file.error ? ' failed' : '') + '"><span class="file-ext" aria-hidden="true">' + escapeHtml(fileExt(file.name)) + '</span><div><span class="file-name">' + escapeHtml(file.name) + '</span><span class="file-meta" role="status">' + escapeHtml(file.error || (file.attachment ? fileSize(file.size) : file.loading ? 'Uploading...' : 'Waiting...')) + '</span></div>' +
      (file.error ? '<button class="msg-more" type="button" data-file-retry="' + file.key + '"' + (chat.uploading || chat.sending ? ' disabled' : '') + '>Retry</button>' : '') +
      '<button class="icon-btn small" type="button" data-file-remove="' + file.key + '" title="Remove file" aria-label="Remove ' + escapeHtml(file.name) + '"' + (chat.sending ? ' disabled' : '') + '>' + ICONS.x + '</button></li>').join('');
  }
  function deleteDraftFile(file) {
    file.controller?.abort();
    if (file.attachment) fetch(file.attachment.url, { method: 'DELETE' }).catch(() => {});
  }
  function clearDraftFiles(discard = true) {
    if (discard) chat.files.forEach(deleteDraftFile);
    chat.files = []; chat.request = null; renderDraftFiles();
  }
  async function uploadDraftFiles(files) {
    if (chat.uploading || chat.sending || !chat.canPost || creatingWorkspace) return;
    chat.uploading = true; chat.request = null; updateComposer();
    const slug = currentSlug(); const scope = { ...chat.scope };
    try {
      for (const file of files) {
        if (!chat.files.includes(file)) continue;
        file.loading = true; file.error = ''; file.controller = new AbortController(); renderDraftFiles();
        const timeout = setTimeout(() => file.controller.abort(), 120000);
        try {
          const query = new URLSearchParams({ name: file.name, team: scope.team, project: scope.project || '', area: scope.area || '' });
          const response = await fetch('/api/workspaces/' + encodeURIComponent(slug) + '/files?' + query, { method: 'POST', body: file.blob, signal: file.controller.signal });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error?.message || 'Upload failed. Try again.');
          if (!chat.files.includes(file)) { fetch(result.attachment.url, { method: 'DELETE' }).catch(() => {}); continue; }
          file.attachment = result.attachment;
        } catch (error) { file.error = error.name === 'AbortError' ? 'Upload interrupted. Try again.' : friendly(error); }
        finally { clearTimeout(timeout); file.loading = false; renderDraftFiles(); }
      }
    } finally { chat.uploading = false; updateComposer(); renderDraftFiles(); }
  }
  async function addChatFiles(files) {
    if (!chat.canPost || !chat.scope || chat.sending || chat.uploading || creatingWorkspace) return;
    const selected = Array.from(files);
    if (selected.length + chat.files.length > 5) { chatFeedback('Attach up to 5 files per message.', true); return; }
    if (selected.some(file => !file.size || file.size > 10485760)) { chatFeedback('Choose non-empty files up to 10 MB each.', true); return; }
    const drafts = selected.map(file => ({ key: crypto.randomUUID(), name: file.name, size: file.size, blob: file, attachment: null, error: '', loading: false }));
    chat.files.push(...drafts); chatFeedback(''); renderDraftFiles(); await uploadDraftFiles(drafts);
  }
  document.getElementById('chat-attach').addEventListener('click', () => document.getElementById('chat-files').click());
  document.getElementById('chat-files').addEventListener('change', event => { addChatFiles(event.target.files); event.target.value = ''; });
  document.getElementById('chat-draft-files').addEventListener('click', event => {
    if (chat.sending) return;
    const remove = event.target.closest('[data-file-remove]');
    const retry = event.target.closest('[data-file-retry]');
    const key = remove?.dataset.fileRemove || retry?.dataset.fileRetry;
    const file = chat.files.find(file => file.key === key); if (!file) return;
    if (remove) { deleteDraftFile(file); chat.files = chat.files.filter(item => item !== file); chat.request = null; renderDraftFiles(); updateComposer(); }
    else if (retry) uploadDraftFiles([file]);
  });
  chatContent.addEventListener('paste', event => {
    if (event.clipboardData?.files.length) { event.preventDefault(); addChatFiles(event.clipboardData.files); }
  });
  const dropZone = document.querySelector('.human-chat');
  dropZone.addEventListener('dragover', event => {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault(); if (chat.canPost && !chat.sending && !chat.uploading) dropZone.classList.add('file-dragging');
  });
  dropZone.addEventListener('dragleave', event => { if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('file-dragging'); });
  dropZone.addEventListener('drop', event => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault(); dropZone.classList.remove('file-dragging'); addChatFiles(event.dataTransfer.files);
  });
  addEventListener('beforeunload', event => { if (hasChatDraft()) { event.preventDefault(); event.returnValue = ''; } });
`;
