const uiMessages = JSON.parse(document.getElementById('ui-messages').textContent);
const uiLocale = document.documentElement.lang === 'en' ? 'en-GB' : 'th-TH';
function tr(message, values = {}) {
  return (uiMessages[message] ?? message).replace(/\{(\w+)\}/g, (token, key) => values[key] ?? token);
}

const chart = document.getElementById('trend-chart');
if (chart) {
  const rows = JSON.parse(chart.dataset.values);
  const upper = Math.max(1, ...rows.map(row => Math.max(row.income, row.expense)));
  const lower = Math.max(0, ...rows.map(row => -row.income));
  const scale = upper + lower;
  const baseline = lower / scale * 100;
  chart.style.minWidth = `${rows.length * 72}px`;
  for (const row of rows) {
    const column = document.createElement('div');
    column.className = 'chart-month';
    const bars = document.createElement('div');
    bars.className = 'bars';
    bars.style.setProperty('--baseline', `${baseline}%`);
    for (const [kind, label] of [['income', tr('รายรับหลังคืนเงิน')], ['expense', tr('รายจ่าย')]]) {
      const bar = document.createElement('span');
      bar.className = `bar ${kind}`;
      bar.title = `${label} ฿${row[kind].toLocaleString(uiLocale)}`;
      bar.style.height = `${Math.abs(row[kind]) / scale * 100}%`;
      bar.style.bottom = `${baseline + Math.min(0, row[kind]) / scale * 100}%`;
      bars.append(bar);
    }
    const label = document.createElement('small');
    label.textContent = row.label;
    column.append(bars, label);
    chart.append(column);
  }
}

const normalizeCustomerName = name => name.normalize('NFC').trim().toLocaleLowerCase('th');

const customerListSearch = document.getElementById('customer-list-search');
if (customerListSearch) {
  const listRows = [...document.querySelectorAll('#customer-list [data-customer-name]')];
  const status = document.getElementById('customer-list-matches');
  function filterCustomerList() {
    const query = normalizeCustomerName(customerListSearch.value);
    let count = 0;
    for (const row of listRows) {
      row.hidden = !normalizeCustomerName(row.dataset.customerName).includes(query);
      if (!row.hidden) count++;
    }
    status.textContent = count ? tr('พบ {count} รายชื่อ', {count}) : tr('ไม่พบลูกค้าที่ตรงกับชื่อที่ค้นหา');
    status.hidden = !query || !listRows.length;
  }
  customerListSearch.addEventListener('input', filterCustomerList);
  filterCustomerList();
}

const form = document.getElementById('stay-form');
if (form) {
  const { customer_id: customer, charged_nights: nights, checkin, checkout, discount } = form.elements;
  const combobox = document.getElementById('stay-customer-combobox');
  const customerSearch = document.getElementById('stay-customer-search');
  const customerOptions = document.getElementById('stay-customer-options');
  const searchStatus = document.getElementById('stay-customer-matches');
  let activeIndex = -1;

  function closeCustomerOptions() {
    customerSearch.value = customer.value ? customer.selectedOptions[0].text : '';
    customerSearch.setAttribute('aria-expanded', 'false');
    customerSearch.removeAttribute('aria-activedescendant');
    customerOptions.hidden = searchStatus.hidden = true;
    activeIndex = -1;
  }

  function chooseCustomer(value) {
    customer.value = value;
    closeCustomerOptions();
    update();
  }

  function showCustomerOptions(search = '') {
    const query = normalizeCustomerName(search);
    const matches = [...customer.options].slice(1).filter(option =>
      normalizeCustomerName(option.text).includes(query));
    activeIndex = -1;
    customerSearch.removeAttribute('aria-activedescendant');
    customerOptions.replaceChildren();
    for (const option of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.id = `stay-customer-option-${option.value}`;
      button.textContent = option.text;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(option.value === customer.value));
      button.addEventListener('click', () => chooseCustomer(option.value));
      customerOptions.append(button);
    }
    customerOptions.hidden = !matches.length;
    searchStatus.hidden = !!matches.length;
    customerSearch.setAttribute('aria-expanded', 'true');
  }

  customerSearch.addEventListener('focus', () => {
    showCustomerOptions();
    customerSearch.select();
  });
  customerSearch.addEventListener('click', () => {
    if (customerSearch.getAttribute('aria-expanded') === 'false') {
      showCustomerOptions();
      customerSearch.select();
    }
  });
  customerSearch.addEventListener('input', () => showCustomerOptions(customerSearch.value));
  customerSearch.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      closeCustomerOptions();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const option = customerOptions.children[activeIndex] ||
        (customerOptions.children.length === 1 && customerOptions.children[0]);
      if (!customerOptions.hidden && option) option.click();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (customerSearch.getAttribute('aria-expanded') === 'false') showCustomerOptions();
    const options = customerOptions.children;
    if (!options.length) return;
    options[activeIndex]?.classList.remove('active');
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    activeIndex = activeIndex < 0 ? (direction === 1 ? 0 : options.length - 1)
      : (activeIndex + direction + options.length) % options.length;
    const active = options[activeIndex];
    active.classList.add('active');
    customerSearch.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  });
  customerOptions.addEventListener('mousedown', event => event.preventDefault());
  document.addEventListener('pointerdown', event => {
    if (!combobox.contains(event.target)) closeCustomerOptions();
  });
  combobox.addEventListener('focusout', event => {
    if (event.relatedTarget && !combobox.contains(event.relatedTarget)) closeCustomerOptions();
  });
  customer.required = false;
  document.getElementById('stay-native-customer').hidden = true;
  combobox.hidden = false;
  closeCustomerOptions();

  const rows = [...form.querySelectorAll('.dog-rate')];
  const picker = form.querySelector('.dog-picker');
  const addDog = form.querySelector('[data-contact-mode="dog"]');
  const empty = document.getElementById('dog-empty');
  const saveStay = document.getElementById('save-stay');
  const ownerProfile = document.getElementById('stay-owner-profile');
  const rateTable = JSON.parse(form.dataset.rateTable);
  const service = form.elements.service_type;
  const rateUnits = {overnight: 'บาท/คืน', daycare: 'บาท/วัน', monthly: 'บาท/เดือน'};
  const chargeUnits = {overnight: 'จำนวนคืนที่คิดเงิน', daycare: 'จำนวนวันที่คิดเงิน', monthly: 'จำนวนเดือนที่คิดเงิน'};
  let previousService = service.value;

  function applyDefaultRate(row) {
    const rate = row.querySelector('input[type=number]');
    if (row.dataset.autoRate === '1') rate.value = rateTable[service.value][row.dataset.rateSize] ?? '';
  }

  const ratesOptional = form.dataset.mode === 'appointment';
  const baht = new Intl.NumberFormat(uiLocale, { style: 'currency', currency: 'THB' });
  const cents = input => Math.round(Number(input.value) * 100) || 0;

  const paymentInput = form.elements.payment_amount;
  const paymentAfter = document.getElementById('payment-after');
  const paymentBalance = document.getElementById('payment-balance');
  paymentInput?.addEventListener('input', () => delete paymentInput.dataset.suggestBalance);

  const couponInput = form.elements.coupon_code;
  const couponButton = document.getElementById('apply-coupon');
  const couponFeedback = document.getElementById('coupon-feedback');
  let appliedCoupon;
  let couponRequest;

  async function lookupCoupon() {
    const code = couponInput.value.trim();
    if (!/^[0-9]{6}$/.test(code)) {
      couponFeedback.textContent = tr('กรุณากรอกรหัสคูปอง 6 หลัก');
      return;
    }
    couponRequest?.abort();
    const controller = new AbortController();
    couponRequest = controller;
    const field = couponInput.closest('.coupon-field');
    couponFeedback.textContent = tr('กำลังตรวจคูปอง');
    try {
      const response = await fetch(field.dataset.couponUrl, {
        method: 'POST', signal: controller.signal,
        body: new URLSearchParams({_csrf: form.elements._csrf.value, code, stay_id: field.dataset.stayId}),
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        appliedCoupon = undefined;
        update();
        couponFeedback.textContent = data.error;
        return;
      }
      appliedCoupon = data;
      update();
    } catch (error) {
      if (error.name !== 'AbortError') couponFeedback.textContent = tr('ตรวจคูปองไม่ได้ กรุณาลองอีกครั้ง');
    } finally {
      if (couponRequest === controller) couponRequest = undefined;
    }
  }

  form.addEventListener('submit', event => {
    if (couponRequest && !couponRequest.signal.aborted) {
      event.preventDefault();
      couponFeedback.textContent = tr('กำลังตรวจคูปอง');
    }
  });
  couponButton?.addEventListener('click', lookupCoupon);
  couponInput?.addEventListener('input', () => {
    couponRequest?.abort();
    appliedCoupon = undefined;
    couponFeedback.textContent = '';
    if (/^[0-9]{6}$/.test(couponInput.value)) lookupCoupon();
  });
  if (couponInput?.value) lookupCoupon();

  function update() {
    let subtotal = 0;
    let visible = false;
    let selected = false;
    let unpriced = false;
    for (const row of rows) {
      const checkbox = row.querySelector('input[type=checkbox]');
      const rate = row.querySelector('input[type=number]');
      row.hidden = row.dataset.customer !== customer.value;
      visible ||= !row.hidden;
      checkbox.disabled = row.hidden;
      rate.disabled = row.hidden || !checkbox.checked;
      rate.required = !rate.disabled && !ratesOptional;
      const profile = row.querySelector('.dog-profile-preview');
      if (profile) profile.hidden = rate.disabled;
      unpriced ||= !rate.disabled && rate.value === '';
      selected ||= !rate.disabled;
      const total = rate.disabled ? 0 : Math.floor((cents(rate) * Math.round((Number(nights.value) || 0) * 100) + 50) / 100);
      row.querySelector('output').textContent = rate.disabled || rate.value === '' ? '' : baht.format(total / 100);
      subtotal += total;
    }
    empty.hidden = visible;
    empty.textContent = customer.value ? tr('ยังไม่มีสุนัขสำหรับลูกค้ารายนี้') : tr('เลือกลูกค้าหรือเพิ่มลูกค้าเพื่อเริ่มบันทึก');
    if (ownerProfile) {
      const details = customer.selectedOptions[0]?.dataset || {};
      ownerProfile.hidden = !customer.value;
      for (const value of ownerProfile.querySelectorAll('[data-owner-value]')) {
        value.textContent = details[value.dataset.ownerValue] || '—';
      }
      ownerProfile.querySelector('button').hidden = details.archived === '1';
    }
    addDog.disabled = !customer.value;
    saveStay.disabled = !selected;
    let couponAmount = 0;
    if (appliedCoupon) {
      if (subtotal < appliedCoupon.minimum_cents) {
        couponFeedback.textContent = tr('ยอดค่าฝากไม่ถึงขั้นต่ำของคูปอง');
      } else {
        couponAmount = Math.min(subtotal, appliedCoupon.kind === 'percent'
          ? Math.round(subtotal * appliedCoupon.value / 10000) : appliedCoupon.value);
        couponFeedback.textContent = tr('ส่วนลดคูปอง {amount}', {amount: baht.format(couponAmount / 100)});
      }
    }
    const discountCents = cents(discount) + couponAmount;
    const rawNet = subtotal - discountCents;
    const existingNet = Math.round(Number(form.dataset.existingNet) * 100);
    const unchanged = form.dataset.existingNet !== '' && discountCents === Number(form.dataset.existingDiscount) &&
      rawNet === existingNet + Number(form.dataset.existingRounding);
    const net = unchanged ? existingNet : Math.floor(rawNet / 100) * 100;
    const rounding = Math.max(0, rawNet - net);
    document.getElementById('stay-rounding-row').hidden = !rounding;
    document.getElementById('stay-rounding').textContent = baht.format(rounding / 100);
    if (paymentInput) {
      const paid = Math.round(Number(paymentInput.closest('fieldset').dataset.paid) * 100);
      const balance = Math.max(0, net - paid);
      paymentBalance.textContent = baht.format(balance / 100);
      paymentInput.max = (balance / 100).toFixed(2);
      if ('suggestBalance' in paymentInput.dataset) paymentInput.value = paymentInput.max;
      paymentAfter.textContent = baht.format(Math.max(0, balance - cents(paymentInput)) / 100);
    }
    const quotePending = ratesOptional && unpriced;
    discount.setCustomValidity(!quotePending && net < 0 ? tr('ส่วนลดต้องไม่เกินยอดก่อนลด') : '');
    document.getElementById('stay-subtotal').textContent = quotePending ? tr('รอระบุราคา') : baht.format(subtotal / 100);
    document.getElementById('stay-net').textContent = quotePending ? tr('รอระบุราคา') : baht.format(net / 100);
  }

  form.addEventListener('input', event => {
    if (event.target.name?.startsWith('rate_')) event.target.closest('.dog-rate').dataset.autoRate = '0';
    update();
  });
  form.addEventListener('change', event => {
    const examItem = event.target.closest('[data-exam-item]');
    if (examItem && event.target.checked) {
      for (const option of examItem.querySelectorAll('input[type=checkbox]')) {
        if (option !== event.target) option.checked = false;
      }
      examItem.querySelectorAll('[data-exam-legacy]').forEach(element => element.remove());
    }
    const daycare = service.value === 'daycare';
    const serviceChanged = event.target.name === 'service_type';
    if (serviceChanged) {
      nights.step = service.value === 'monthly' ? '0.01' : '1';
      rows.forEach(applyDefaultRate);
      form.querySelector('[data-charge-unit]').textContent = tr(chargeUnits[service.value]);
      rows.forEach(row => row.querySelector('[data-rate-unit]').textContent = tr(rateUnits[service.value]));
    }
    if (service.value === 'monthly') {
      if ((serviceChanged || [checkin, checkout].includes(event.target)) && checkin.value && checkout.value) {
        const days = Math.max(1, (checkout.valueAsNumber - checkin.valueAsNumber) / 86400000);
        nights.value = String(Math.round(days * 100 / 30) / 100);
      }
    } else if (([checkin, checkout].includes(event.target) || (serviceChanged &&
         (previousService === 'monthly' || form.dataset.newCheckin === 'true' || form.dataset.newBooking === 'true'))) && checkin.value && checkout.value) {
      const minimum = daycare || form.dataset.newCheckin === 'true' ? 1 : 0;
      nights.value = Math.max(minimum, (checkout.valueAsNumber - checkin.valueAsNumber) / 86400000);
    }
    previousService = service.value;
    update();
  });
  const dialog = document.getElementById('stay-contact-dialog');
  const contactForm = document.getElementById('stay-contact-form');
  const fields = contactForm.elements;
  const error = document.getElementById('contact-error');
  const success = document.getElementById('contact-success');
  const saveContact = contactForm.querySelector('[type=submit]');
  const cancelContact = document.getElementById('close-contact');
  let saving = false;

  for (const trigger of form.querySelectorAll('[data-contact-mode]')) {
    trigger.addEventListener('click', () => {
      const mode = trigger.dataset.contactMode;
      const editOwner = mode === 'edit_customer';
      const ownerMode = mode !== 'dog';
      const details = customer.selectedOptions[0]?.dataset || {};
      contactForm.reset();
      fields.mode.value = mode;
      fields.customer_id.value = customer.value;
      fields.customer_name.required = ownerMode;
      fields.dog_name.required = !ownerMode;
      const ownerFields = document.getElementById('new-owner-fields');
      ownerFields.hidden = !ownerMode;
      for (const input of ownerFields.querySelectorAll('input,textarea')) input.disabled = !ownerMode;
      const dogFields = document.getElementById('contact-dog-fields');
      dogFields.hidden = editOwner;
      for (const input of dogFields.querySelectorAll('input,select')) input.disabled = editOwner;
      if (editOwner) {
        fields.customer_name.value = customer.selectedOptions[0].text;
        fields.owner_phone.value = details.phone || '';
        fields.line_id.value = details.line || '';
        fields.emergency_address.value = details.address || '';
      }
      const owner = document.getElementById('selected-owner');
      owner.hidden = ownerMode;
      owner.textContent = customer.selectedOptions[0]?.textContent || '';
      document.getElementById('stay-contact-title').textContent = tr(
        editOwner ? 'แก้ไขข้อมูลลูกค้า' : ownerMode ? 'เพิ่มลูกค้า' : 'เพิ่มสุนัข');
      document.getElementById('new-dog-label').textContent = ownerMode ? tr('ชื่อสุนัข (ถ้ามี)') : tr('ชื่อสุนัข');
      error.hidden = true;
      success.hidden = true;
      dialog.showModal();
      (ownerMode ? fields.customer_name : fields.dog_name).focus();
    });
  }
  cancelContact.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => {
    if (saving) event.preventDefault();
  });

  contactForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    saveContact.disabled = cancelContact.disabled = true;
    error.hidden = true;
    try {
      const response = await fetch(contactForm.action, { method: 'POST', body: new FormData(contactForm) });
      const result = await response.json();
      if (!response.ok) {
        error.textContent = tr(result.error);
        error.hidden = false;
        return;
      }
      const ownerId = String(result.customer.id);
      let option = [...customer.options].find(option => option.value === ownerId);
      if (!option) {
        option = new Option('', ownerId);
        customer.add(option);
      }
      option.text = result.customer.name;
      Object.assign(option.dataset, {
        phone: result.customer.owner_phone,
        line: result.customer.line_id,
        address: result.customer.emergency_address,
      });
      chooseCustomer(ownerId);
      let rate;
      if (result.dog) {
        const row = document.getElementById('new-dog-row').content.firstElementChild.cloneNode(true);
        row.dataset.customer = ownerId;
        const checkbox = row.querySelector('input[type=checkbox]');
        checkbox.value = result.dog.id;
        row.querySelector('.dog-name').textContent = result.dog.name;
        if (result.dog.photo_url) {
          const image = document.createElement('img');
          image.src = result.dog.photo_url;
          image.alt = '';
          image.width = image.height = 64;
          row.querySelector('.dog-avatar').replaceChildren(image);
        }
        rate = row.querySelector('input[type=number]');
        rate.name = `rate_${result.dog.id}`;
        row.dataset.rateSize = result.dog.size;
        row.dataset.autoRate = '1';
        row.querySelector('[data-rate-unit]').textContent = tr(rateUnits[service.value]);
        applyDefaultRate(row);
        const editDog = row.querySelector('[data-edit-dog]');
        if (editDog) {
          editDog.dataset.profileUrl = result.dog.profile_url;
          editDog.hidden = false;
        }
        rows.push(row);
        picker.append(row);
      }
      update();
      dialog.close();
      success.textContent = fields.mode.value === 'edit_customer' ? tr('บันทึกแล้ว') : result.dog ? tr('เพิ่มสุนัข {name} แล้ว', {name: result.dog.name}) : tr('เพิ่มลูกค้า {name} แล้ว', {name: result.customer.name});
      success.hidden = false;
      (rate || (fields.mode.value === 'edit_customer' && ownerProfile?.querySelector('button')) || addDog).focus();
    } catch {
      error.textContent = tr('เชื่อมต่อเพื่อบันทึกไม่ได้ กรุณาตรวจว่าข้อมูลขึ้นในรายการแล้วหรือยัง');
      error.hidden = false;
    } finally {
      saving = false;
      saveContact.disabled = cancelContact.disabled = false;
    }
  });

  update();
}

document.addEventListener('change', event => {
  const input = event.target;
  if (input.type !== 'file' || !['dog_photo', 'dog_camera'].includes(input.name)) return;
  const { dog_photo: photo, dog_camera: camera } = input.form.elements;
  if (input.files.length) {
    if (input === photo) camera.value = '';
    else photo.value = '';
  }
  const filename = camera.closest('.dog-camera').querySelector('.dog-camera-filename');
  filename.textContent = camera.files[0]?.name || '';
  filename.hidden = !filename.textContent;
});

document.addEventListener('reset', event => {
  for (const filename of event.target.querySelectorAll('.dog-camera-filename')) {
    filename.textContent = '';
    filename.hidden = true;
  }
});

const signaturePanel = document.getElementById('stay-signature');
if (signaturePanel) {
  const signatureForm = signaturePanel.closest('form');
  const signatureInput = signatureForm.elements.signature;
  const acknowledgement = signatureForm.elements.terms_ack;
  const pad = document.getElementById('stay-signature-pad');
  const ink = document.getElementById('stay-signature-strokes');
  const error = document.getElementById('stay-signature-error');
  const strokes = signatureInput.value ? JSON.parse(signatureInput.value) : [];
  let pointCount = strokes.reduce((count, stroke) => count + stroke.length, 0);
  let activePointer = null;
  let activePointerType;
  let activeLine;

  function finishStroke(discard = false) {
    if (activePointer === null) return;
    const pointer = activePointer;
    activePointer = null;
    activePointerType = undefined;
    const stroke = strokes[strokes.length - 1];
    if (discard || stroke.length === 1) {
      pointCount -= stroke.length;
      strokes.pop();
      activeLine.remove();
    }
    if (pad.hasPointerCapture?.(pointer)) pad.releasePointerCapture(pointer);
    saveInk();
  }

  function draw(stroke, line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')) {
    line.setAttribute('points', stroke.map(point => point.join(',')).join(' '));
    if (!line.parentNode) ink.append(line);
    return line;
  }

  function point(event) {
    const rect = pad.getBoundingClientRect();
    return [
      Math.round(Math.min(720, Math.max(0, (event.clientX - rect.left) * 720 / rect.width))),
      Math.round(Math.min(240, Math.max(0, (event.clientY - rect.top) * 240 / rect.height))),
    ];
  }

  function saveInk() {
    signatureInput.value = strokes.length ? JSON.stringify(strokes) : '';
  }

  strokes.forEach(stroke => draw(stroke));
  for (const type of ['contextmenu', 'selectstart']) {
    signaturePanel.addEventListener(type, event => event.preventDefault());
  }
  // Older Safari can start a long-press callout even with touch-action disabled.
  pad.addEventListener('touchstart', event => {
    if (event.cancelable) event.preventDefault();
  }, { passive: false });

  pad.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (event.pointerType === 'touch' && !event.isPrimary)) return;
    if (activePointer !== null) {
      // A stylus can take over from a palm that touched the pad first.
      if (event.pointerType !== 'pen' || activePointerType !== 'touch') return;
      finishStroke(true);
    }
    if (strokes.length >= 150 || pointCount >= 4000) return;
    event.preventDefault();
    pad.setPointerCapture(event.pointerId);
    activePointer = event.pointerId;
    activePointerType = event.pointerType;
    const stroke = [point(event)];
    strokes.push(stroke);
    pointCount++;
    activeLine = draw(stroke);
    error.hidden = true;
  });
  pad.addEventListener('pointermove', event => {
    if (event.pointerId !== activePointer || pointCount >= 4000) return;
    const stroke = strokes[strokes.length - 1];
    const next = point(event);
    const last = stroke[stroke.length - 1];
    if (Math.hypot(next[0] - last[0], next[1] - last[1]) < 2) return;
    stroke.push(next);
    pointCount++;
    draw(stroke, activeLine);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    pad.addEventListener(type, event => {
      if (event.pointerId === activePointer) finishStroke(type === 'pointercancel');
    });
  }
  document.getElementById('clear-stay-signature').addEventListener('click', () => {
    finishStroke(true);
    strokes.length = 0;
    pointCount = 0;
    ink.replaceChildren();
    saveInk();
    error.hidden = true;
  });
  signatureForm.addEventListener('submit', event => {
    saveInk();
    const originalOwner = signaturePanel.dataset.originalOwner;
    const ownerChanged = originalOwner && originalOwner !== signatureForm.elements.customer_id.value;
    const signing = signaturePanel.dataset.required === 'true' || ownerChanged || acknowledgement.checked || strokes.length;
    if (!signing) return;
    const signed = strokes.some(([[x, y], ...points]) =>
      points.some(([px, py]) => (px - x) ** 2 + (py - y) ** 2 >= 64));
    if (acknowledgement.checked && signed) return;
    event.preventDefault();
    error.textContent = acknowledgement.checked
      ? tr('กรุณาให้ลูกค้าเซ็นลายเซ็นในช่องที่กำหนด')
      : tr('กรุณาติ๊กรับทราบเงื่อนไขการฝากเลี้ยง');
    error.hidden = false;
    error.scrollIntoView({ block: 'nearest' });
    if (!acknowledgement.checked) acknowledgement.focus({ preventScroll: true });
  });
}

function shiftCalendarMonths(iso, offset) {
  const [year, month, day] = iso.split('-').map(Number);
  const index = year*12+month-1+offset;
  const nextYear = Math.floor(index/12);
  const nextMonth = index%12+1;
  if (nextYear < 1 || nextYear > 9999) return '';
  const leap = nextYear%4 === 0 && (nextYear%100 !== 0 || nextYear%400 === 0);
  const monthDays = [31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return [String(nextYear).padStart(4,'0'),String(nextMonth).padStart(2,'0'),
          String(Math.min(day,monthDays[nextMonth-1])).padStart(2,'0')].join('-');
}

document.addEventListener('input', event => {
  const input = event.target;
  const group = input.closest('[data-dog-age]');
  if (!group) return;
  const { birth_date: birth, age_years: years, age_months: months, age_source: source,
          birth_estimated: estimated } = input.form.elements;
  const today = group.dataset.today;
  if (input === birth) {
    source.value = 'birth';
    estimated.value = '0';
    years.value = months.value = '';
    if (!birth.value || !birth.validity.valid) return;
    const [year, month] = birth.value.split('-').map(Number);
    const [todayYear, todayMonth] = today.split('-').map(Number);
    let difference = (todayYear-year)*12+todayMonth-month;
    if (shiftCalendarMonths(birth.value, difference) > today) difference--;
    years.value = Math.floor(difference/12);
    months.value = difference%12;
  } else if (input === years || input === months) {
    source.value = 'age';
    estimated.value = '1';
    if ((!years.value && !months.value) || !years.validity.valid || !months.validity.valid) {
      birth.value = '';
      return;
    }
    birth.value = shiftCalendarMonths(today, -(Number(years.value)*12+Number(months.value)));
  }
  const help = group.querySelector('[data-age-help]');
  help.textContent = estimated.value === '1' && birth.value
    ? tr('วันเกิดนี้คำนวณจากอายุโดยประมาณ')
    : tr('กรอกวันเกิดหรืออายุโดยประมาณ ระบบจะคำนวณให้อีกช่อง');
});

const dogProfileDialog = document.getElementById('dog-profile-dialog');
if (dogProfileDialog) {
  const content = dogProfileDialog.querySelector('[data-profile-form]');
  let dogRow;
  let savingProfile = false;
  let profileRequest;
  function showProfileError(error) {
    const feedback = content.querySelector('[data-profile-error]') || document.createElement('p');
    feedback.className = 'alert error';
    feedback.textContent = error;
    feedback.hidden = false;
    if (!feedback.parentNode) content.replaceChildren(feedback);
  }

  document.getElementById('stay-form').addEventListener('click', async event => {
    const trigger = event.target.closest('[data-edit-dog]');
    if (!trigger?.dataset.profileUrl) return;
    dogRow = trigger.closest('.dog-rate');
    content.textContent = tr('กำลังโหลดข้อมูลสุนัข');
    dogProfileDialog.showModal();
    const request = new AbortController();
    profileRequest = request;
    try {
      const response = await fetch(trigger.dataset.profileUrl, {signal: request.signal});
      if (!response.ok) throw new Error();
      const html = await response.text();
      if (!request.signal.aborted) content.innerHTML = html;
    } catch {
      if (!request.signal.aborted) showProfileError(tr('เปิดข้อมูลสุนัขไม่ได้ กรุณาลองใหม่'));
    }
  });
  dogProfileDialog.addEventListener('close', () => profileRequest?.abort());
  dogProfileDialog.addEventListener('click', event => {
    if (event.target.closest('[data-close-profile]') && !savingProfile) dogProfileDialog.close();
  });
  dogProfileDialog.addEventListener('cancel', event => {
    if (savingProfile) event.preventDefault();
  });
  dogProfileDialog.addEventListener('submit', async event => {
    event.preventDefault();
    if (savingProfile) return;
    const editForm = event.target;
    const submit = editForm.querySelector('[type=submit]');
    submit.disabled = savingProfile = true;
    try {
      const response = await fetch(editForm.action, {
        method: 'POST', headers: {'Accept': 'application/json'}, body: new FormData(editForm),
      });
      const result = await response.json();
      if (!response.ok) {
        showProfileError(result.error || tr('บันทึกข้อมูลสุนัขไม่ได้ กรุณาลองใหม่'));
        return;
      }
      dogRow.querySelector('.dog-name').textContent = result.name;
      dogRow.querySelector('.dog-profile-content').innerHTML = result.profile_html;
      if (result.photo_url) {
        const image = document.createElement('img');
        image.src = result.photo_url;
        image.alt = '';
        image.width = image.height = 64;
        dogRow.querySelector('.dog-avatar').replaceChildren(image);
      }
      dogProfileDialog.close();
    } catch {
      showProfileError(tr('บันทึกข้อมูลสุนัขไม่ได้ กรุณาลองใหม่'));
    } finally {
      submit.disabled = savingProfile = false;
    }
  });
}

const couponKind = document.getElementById('coupon-kind');
if (couponKind) {
  const value = couponKind.form.elements.value;
  function updateCouponKind() {
    const fixed = couponKind.value === 'fixed';
    value.max = fixed ? '999999999' : '100';
  }
  couponKind.addEventListener('change', updateCouponKind);
  updateCouponKind();
}

const imageExportDialog = document.getElementById('image-export-preview');
if (imageExportDialog?.showModal) {
  const preview = imageExportDialog.querySelector('[data-image-preview]');
  const status = imageExportDialog.querySelector('[data-image-status]');
  const share = imageExportDialog.querySelector('[data-image-share]');
  const save = imageExportDialog.querySelector('[data-image-save]');
  const retry = imageExportDialog.querySelector('[data-image-retry]');
  const help = imageExportDialog.querySelector('[data-image-help]');
  let request;
  let objectUrl;
  let file;

  imageExportDialog.addEventListener('close', () => {
    request?.abort();
    preview.removeAttribute('src');
    save.removeAttribute('href');
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = file = undefined;
  });

  async function openImageExport(link) {
    if (imageExportDialog.open) return;

    preview.hidden = share.hidden = save.hidden = retry.hidden = help.hidden = true;
    status.textContent = tr('กำลังเตรียมรูปภาพ…');
    imageExportDialog.showModal();
    const controller = new AbortController();
    request = controller;
    try {
      const response = await fetch(link.href, {signal: controller.signal});
      if (!response.ok || !response.headers.get('Content-Type')?.startsWith('image/png')) throw new Error();
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const filename = /filename="?([\w.-]+\.png)/i.exec(response.headers.get('Content-Disposition') || '')?.[1] || 'little-paws.png';
      objectUrl = URL.createObjectURL(blob);
      file = new File([blob], filename, {type: 'image/png'});
      preview.src = save.href = objectUrl;
      save.download = filename;
      preview.hidden = save.hidden = help.hidden = false;
      share.hidden = !(navigator.share && navigator.canShare?.({files: [file]}));
      status.textContent = '';
    } catch {
      if (controller.signal.aborted) return;
      status.textContent = tr('โหลดรูปไม่ได้ กรุณาลองอีกครั้ง');
      retry.href = link.href;
      retry.hidden = false;
    }
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('a[data-image-export]');
    if (!link || event.defaultPrevented || event.button !== 0 ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openImageExport(link);
  });

  const automaticPreview = document.querySelector('[data-image-export-auto]');
  if (automaticPreview) openImageExport(automaticPreview);

  share.addEventListener('click', async () => {
    try {
      await navigator.share({files: [file]});
    } catch (error) {
      if (error.name !== 'AbortError') status.textContent = tr('แตะค้างที่รูปเพื่อบันทึกหรือแชร์');
    }
  });
}

document.addEventListener('click', event => {
  const opener = event.target.closest('[data-care-dialog]');
  if (opener) {
    const dialog = document.getElementById(opener.dataset.careDialog);
    const dateField = dialog.querySelector('[data-care-current-date]');
    if (dateField) {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).formatToParts(new Date());
      const now = Object.fromEntries(parts.map(part => [part.type, part.value]));
      dateField.value = dateField.max = [now.year, now.month, now.day].join('-');
      dialog.querySelector('[name="care_time"]').value = [now.hour, now.minute].join(':');
    }
    dialog.showModal();
  }
  const closer = event.target.closest('[data-care-close]');
  if (closer) closer.closest('dialog').close();
});

document.querySelectorAll('[data-care-kind]').forEach(select => {
  const sync = () => { select.form.elements.note.required = select.value === 'custom'; };
  select.addEventListener('change', sync);
  sync();
});

const seasonMotion = document.querySelector('.season-motion');
if (seasonMotion && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(([entry]) => {
    seasonMotion.classList.toggle('is-outside-view', !entry.isIntersecting);
  });
  observer.observe(seasonMotion);
}

const accountMenu = document.querySelector('.account-menu');
if (accountMenu) {
  document.addEventListener('click', event => {
    if (accountMenu.open && !accountMenu.contains(event.target)) accountMenu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && accountMenu.open) {
      accountMenu.open = false;
      accountMenu.querySelector('summary').focus();
    }
  });
}

const copyShareButton = document.querySelector('[data-copy-share]');
if (copyShareButton) {
  copyShareButton.addEventListener('click', async () => {
    const url = document.querySelector('[data-share-url]');
    const status = document.querySelector('[data-share-status]');
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(url.value);
      } else {
        url.focus();
        url.select();
        url.setSelectionRange(0, url.value.length);
        if (!document.execCommand('copy')) throw new Error();
      }
      status.textContent = copyShareButton.dataset.copied;
    } catch {
      url.focus();
      url.select();
      status.textContent = copyShareButton.dataset.copyHelp;
    }
  });
}

document.querySelectorAll('[data-care-date-strip]').forEach(strip => {
  const selected = strip.querySelector('[aria-current="page"]');
  if (!selected) return;
  const viewport = strip.getBoundingClientRect();
  const item = selected.getBoundingClientRect();
  if (item.right > viewport.right) {
    strip.scrollLeft += item.left - viewport.left - 4;
  }
});
