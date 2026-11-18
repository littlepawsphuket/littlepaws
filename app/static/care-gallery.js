export function installCarePhotoViewer() {
  if (document.getElementById('care-photo-viewer')) return;
  const english = document.documentElement.lang === 'en';
  const dialog = document.createElement('dialog');
  dialog.id = 'care-photo-viewer';
  dialog.className = 'care-photo-viewer';
  dialog.setAttribute('aria-label', english ? 'Activity photo' : 'รูปกิจกรรม');
  const panel = document.createElement('div');
  panel.className = 'care-photo-panel';
  const toolbar = document.createElement('div');
  toolbar.className = 'care-photo-toolbar';
  const title = document.createElement('strong');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'care-photo-close';
  close.textContent = english ? '× Close' : '× ปิด';
  close.setAttribute('aria-label', english ? 'Close photo' : 'ปิดรูปภาพ');
  const image = document.createElement('img');
  image.className = 'care-photo-full';
  image.referrerPolicy = 'no-referrer';
  const error = document.createElement('p');
  error.className = 'care-photo-error';
  error.setAttribute('role', 'status');
  error.textContent = english ? 'Unable to load the photo. Please close and try again.' : 'โหลดรูปไม่สำเร็จ กรุณาปิดแล้วลองใหม่';
  error.hidden = true;
  toolbar.append(title, close);
  panel.append(toolbar, image, error);
  dialog.append(panel);
  document.body.append(dialog);
  let opened = false;
  let trigger = null;
  let previousOverflow = '';
  function finish() {
    if (!opened) return;
    opened = false;
    image.removeAttribute('src');
    document.body.style.overflow = previousOverflow;
    if (trigger?.isConnected) trigger.focus({preventScroll: true});
    trigger = null;
  }
  function dismiss() {
    if (!opened) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    finish();
  }
  close.addEventListener('click', dismiss);
  dialog.addEventListener('close', finish);
  dialog.addEventListener('cancel', event => { event.preventDefault(); dismiss(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) dismiss(); });
  image.addEventListener('load', () => { error.hidden = true; });
  image.addEventListener('error', () => { if (opened) error.hidden = false; });
  document.addEventListener('keydown', event => {
    if (!opened) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      close.focus();
    }
  }, true);
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[data-care-photo]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const source = new URL(link.href, location.href);
    if (source.origin !== location.origin || !/^https?:$/.test(source.protocol)) return;
    event.preventDefault();
    if (opened) return;
    trigger = link;
    previousOverflow = document.body.style.overflow;
    opened = true;
    error.hidden = true;
    title.textContent = link.querySelector('img')?.alt || (english ? 'Activity photo' : 'รูปกิจกรรม');
    image.alt = title.textContent;
    image.src = source.href;
    document.body.style.overflow = 'hidden';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      dialog.classList.add('care-photo-fallback');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('open', '');
    }
    close.focus({preventScroll: true});
  });
}

if (typeof document !== 'undefined') installCarePhotoViewer();
