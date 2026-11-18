export function reportScreen({
  translateLabel,
  node,
  results,
  message,
  today,
  reload,
  isActive,
  openRecord,
  canExport,
  back,
}) {
  const names = {
    finance: "รายรับ–รายจ่าย",
    balances: "ยอดค้างชำระ",
    boarding: "การจองและการเข้าพัก",
    coupons: "การใช้คูปอง",
    customers: "ลูกค้าใหม่และลูกค้ากลับมาใช้ซ้ำ",
  };
  const current = today();
  const [year, month] = current.split("-").map(Number);
  let state = {
    name: "finance",
    start: current.slice(0, 7) + "-01",
    end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
    lang: document.documentElement.lang,
  };
  let generation = 0;
  const query = () =>
    new URLSearchParams(
      Object.entries(state).filter(
        ([key, value]) => key !== "name" && value !== "",
      ),
    );
  const button = (text, action) =>
    Object.assign(node("button", text), { type: "button", onclick: action });
  const field = (label, input) => {
    const wrapper = node("label", label);
    wrapper.append(input);
    return wrapper;
  };
  const select = (label, choices, value) => {
    const input = node("select");
    input.setAttribute("aria-label", label);
    for (const [id, text] of choices) input.append(new Option(text, id));
    input.value = value || "";
    return input;
  };
  function format(value, type, lang) {
    if (value === null || value === undefined || value === "") return "—";
    if (type === "date")
      return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "th-TH", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date(value + "T00:00:00Z"));
    if (type === "money")
      return new Intl.NumberFormat(lang === "en" ? "en-GB" : "th-TH", {
        style: "currency",
        currency: "THB",
      }).format(value / 100);
    return String(value);
  }
  function render({ report, choices }) {
    const activeGeneration = ++generation;
    const toolbar = Object.assign(node("section"), { className: "card" });
    toolbar.append(button("กลับไปหน้าตั้งค่า", back));
    const form = Object.assign(node("form"), { className: "report-filters" });
    const fields = Object.assign(node("div"), { className: "formgrid" });
    const name = select("รายงาน", Object.entries(names), state.name);
    const language = select(
      "ภาษารายงาน",
      [
        ["th", "ไทย"],
        ["en", "English"],
      ],
      state.lang,
    );
    const start = Object.assign(node("input"), {
      type: "date",
      value: state.start,
      required: true,
    });
    const end = Object.assign(node("input"), {
      type: "date",
      value: state.end,
      required: true,
    });
    fields.append(
      field("รายงาน", name),
      field("ภาษารายงาน", language),
      field("ตั้งแต่", start),
      field("ถึง", end),
    );
    const filters = {};
    const add = (key, label, options) => {
      const input = select(label, [["", "ทั้งหมด"], ...options], state[key]);
      fields.append(field(label, input));
      filters[key] = input;
    };
    if (state.name === "finance") {
      add("kind", "ประเภท", [
        ["income", "รายรับ"],
        ["expense", "รายจ่าย"],
        ["refund", "เงินคืน"],
      ]);
      add(
        "category",
        "หมวดหมู่",
        choices.categories.map((value) => [value, translateLabel(value)]),
      );
    }
    if (["boarding", "balances"].includes(state.name)) {
      add(
        "customer",
        "ลูกค้า",
        choices.customers.map((value) => [String(value.id), value.name]),
      );
      add("service", "ประเภทบริการ", [
        ["overnight", "ฝากค้างคืน"],
        ["daycare", "ฝากระหว่างวัน"],
        ["monthly", "ฝากรายเดือน"],
      ]);
      add("status", "สถานะ", [
        ["checked_in", "กำลังเข้าพัก"],
        ["completed", "กลับบ้านแล้ว"],
      ]);
    }
    if (state.name === "customers")
      add("segment", "กลุ่มลูกค้า", [
        ["registered", "เพิ่มโปรไฟล์"],
        ["first_booking", "จองครั้งแรก"],
        ["new", "ฝากครั้งแรก"],
        ["returning", "กลับมาฝาก"],
      ]);
    if (state.name === "coupons") {
      const input = Object.assign(node("input"), {
        type: "text",
        inputMode: "numeric",
        pattern: "[0-9]{6}",
        maxLength: 6,
        value: state.code || "",
      });
      fields.append(field("รหัสคูปอง", input));
      filters.code = input;
    }
    const submit = Object.assign(node("button", "แสดงรายงาน"), {
      type: "submit",
    });
    const actions = Object.assign(node("div"), { className: "actions" });
    const apply = () => {
      end.setCustomValidity(
        start.value > end.value ? "วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น" : "",
      );
      if (!form.reportValidity()) return;
      state = {
        name: name.value,
        lang: language.value,
        start: start.value,
        end: end.value,
        ...Object.fromEntries(
          Object.entries(filters).map(([key, input]) => [
            key,
            input.value.trim(),
          ]),
        ),
      };
      generation++;
      message.textContent = "";
      reload();
    };
    actions.append(
      submit,
      button("เดือนปัจจุบัน", () => {
        start.value = current.slice(0, 7) + "-01";
        end.value = new Date(Date.UTC(year, month, 0))
          .toISOString()
          .slice(0, 10);
        apply();
      }),
      button("ปีปัจจุบัน", () => {
        start.value = year + "-01-01";
        end.value = year + "-12-31";
        apply();
      }),
    );
    form.append(fields, actions);
    form.onsubmit = (event) => {
      event.preventDefault();
      apply();
    };
    form.oninput = () => end.setCustomValidity("");
    name.onchange = () => {
      generation++;
      state = {
        name: name.value,
        lang: language.value,
        start: start.value,
        end: end.value,
      };
      reload();
    };
    language.onchange = apply;
    toolbar.append(form);
    if (report.error) {
      results.replaceChildren(toolbar);
      return;
    }
    const output = Object.assign(node("section"), { className: "card" });
    output.append(
      node("h2", report.title),
      node(
        "p",
        format(report.start, "date", report.lang) +
          " – " +
          format(report.end, "date", report.lang),
      ),
      node("p", report.note),
    );
    const summary = Object.assign(node("div"), { className: "report-summary" });
    for (const item of report.summary) {
      const stat = Object.assign(node("div"), { className: "report-stat" });
      stat.append(
        node("small", item.label),
        node("strong", format(item.value, item.type, report.lang)),
      );
      summary.append(stat);
    }
    output.append(summary);
    if (report.peakDay)
      output.append(
        node(
          "p",
          (report.lang === "en" ? "Peak day · " : "วันสูงสุด · ") +
            format(report.peakDay, "date", report.lang),
        ),
      );
    const exports = Object.assign(node("div"), { className: "actions" });
    const base = "/api/reports/" + state.name;
    for (const [kind, label] of [
      ["xlsx", "Excel"],
      ["html", "เปิดแบบพิมพ์"],
      ["pdf", "PDF"],
    ]) {
      if (kind === "pdf" && !canExport) continue;
      exports.append(
        Object.assign(node("a", label), {
          href: base + "." + kind + "?" + query(),
          className: "button secondary",
          target: "_blank",
          rel: "noopener",
        }),
      );
    }
    if (canExport)
      exports.append(
        button("รูปภาพ PNG", async (event) => {
          const control = event.currentTarget;
          control.disabled = true;
          message.textContent = "กำลังสร้างรูป…";
          try {
            const response = await fetch(base + ".png?" + query());
            if (!response.ok || !response.headers.get("Content-Type")?.startsWith("image/png")) throw Error();
            const source = URL.createObjectURL(await response.blob());
            if (!isActive() || generation !== activeGeneration) {
              URL.revokeObjectURL(source);
              return;
            }
            const dialog = Object.assign(node("dialog"), {
              className: "report-image-dialog",
            });
            dialog.setAttribute("aria-label", "ตัวอย่างรูปภาพรายงาน");
            const img = Object.assign(node("img"), {
              src: source,
              alt: report.title,
              className: "coupon-preview",
            });
            const save = Object.assign(node("a", "บันทึกรูปภาพ"), {
              href: source,
              download: "little-paws-" + state.name + ".png",
              className: "button",
              target: "_blank",
              rel: "noopener",
            });
            dialog.append(
              button("ปิด", () => dialog.close()),
              img,
              save,
              node("p", "แตะค้างที่รูปเพื่อบันทึกหรือแชร์"),
            );
            dialog.onclose = () => {
              URL.revokeObjectURL(source);
              dialog.remove();
            };
            document.body.append(dialog);
            dialog.showModal();
            message.textContent = "";
          } catch {
            if (isActive() && generation === activeGeneration)
              message.textContent = "สร้างรูปภาพไม่สำเร็จ กรุณาลองใหม่";
          } finally {
            control.disabled = false;
          }
        }),
      );
    output.append(exports);
    if (canExport)
      output.append(
        node(
          "p",
          report.lang === "en"
            ? "Image exports include the summary and charts."
            : "รูปภาพส่งออกแสดงสรุปและกราฟ",
        ),
      );
    if (report.chart?.months.length) {
      const chart = Object.assign(node("div"), {
        className: "dashboard-trend",
      });
      const max = Math.max(
        1,
        ...report.chart.months.flatMap((item) => item.values.map(Math.abs)),
      );
      const colors = ["#257b69", "#bd6a5b", "#8b6baf"];
      for (const item of report.chart.months) {
        const column = Object.assign(node("div"), {
          className: "dashboard-month",
        });
        const bars = Object.assign(node("div"), {
          className: "dashboard-bars",
        });
        item.values.forEach((value, index) => {
          const bar = Object.assign(node("span"), {
            className: "dashboard-bar",
            title:
              report.chart.series[index] +
              " · " +
              format(value, report.chart.type, report.lang),
          });
          bar.setAttribute("aria-label", bar.title);
          bar.style.height = Math.max(1, (Math.abs(value) / max) * 100) + "%";
          bar.style.backgroundColor = colors[index % colors.length];
          bars.append(bar);
        });
        column.append(bars, node("small", item.month));
        chart.append(column);
      }
      output.append(chart, node("p", report.chart.series.join(" · ")));
    }
    for (const group of report.groups) {
      output.append(node("h3", group.label));
      for (const [label, value] of group.items) {
        const entry = Object.assign(node("div"), {
          className: "dashboard-recent",
        });
        entry.append(
          node("span", label),
          node("strong", format(value, group.type, report.lang)),
        );
        output.append(entry);
      }
    }
    const sheet = Object.assign(node("div"), { className: "ledger-sheet" });
    const table = node("table"),
      head = node("thead"),
      header = node("tr"),
      body = node("tbody");
    for (const item of report.columns) header.append(node("th", item.label));
    head.append(header);
    table.append(head, body);
    sheet.append(table);
    let offset = 0;
    const more = button("แสดงรายการเพิ่มเติม", appendRows);
    function appendRows() {
      for (const item of report.rows.slice(offset, offset + 100)) {
        const tr = node("tr");
        item.values.forEach((value, index) => {
          const cell = node("td");
          const text = format(value, report.columns[index].type, report.lang);
          cell.append(
            index === 0
              ? button(text, () => openRecord(item.link))
              : node("span", text),
          );
          tr.append(cell);
        });
        body.append(tr);
      }
      offset += 100;
      more.hidden = offset >= report.rows.length;
    }
    appendRows();
    output.append(
      node(
        "p",
        (report.lang === "en" ? "Records · " : "จำนวนรายการ · ") +
          report.rows.length,
      ),
      sheet,
      more,
    );
    if (!report.rows.length)
      output.append(
        node(
          "p",
          report.lang === "en"
            ? "No records in this period."
            : "ไม่พบข้อมูลในช่วงที่เลือก",
        ),
      );
    results.replaceChildren(toolbar, output);
  }
  return { render, query, name: () => state.name };
}
