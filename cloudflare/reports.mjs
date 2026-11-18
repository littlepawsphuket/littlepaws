import { validDay } from "./bookings.mjs";
import { stayBalance } from "./stay_payments.mjs";

export const reportNames = {
  finance: ["รายรับ–รายจ่าย", "Income and expenses"],
  balances: ["ยอดค้างชำระ", "Outstanding balances"],
  boarding: ["การจองและการเข้าพัก", "Bookings and stays"],
  coupons: ["การใช้คูปอง", "Coupon usage"],
  customers: ["ลูกค้าใหม่และลูกค้ากลับมาใช้ซ้ำ", "New and returning customers"],
};
const rowLimit = 5000;
const money = (value) => Math.round(Number(value || 0) * 100);
const services = {
  overnight: ["ฝากค้างคืน", "Overnight"],
  daycare: ["ฝากระหว่างวัน", "Day care"],
  monthly: ["ฝากรายเดือน", "Monthly"],
};

export function reportFilters(query, now = new Date()) {
  const today = new Date(now.valueOf() + 7 * 3600000);
  const start = query.get("start") || today.toISOString().slice(0, 7) + "-01";
  const end =
    query.get("end") ||
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10);
  const filters = Object.fromEntries(
    [
      "kind",
      "category",
      "customer",
      "service",
      "status",
      "code",
      "segment",
    ].map((key) => [key, query.get(key) || ""]),
  );
  if (
    !validDay(start) ||
    !validDay(end) ||
    start > end ||
    filters.category.length > 120 ||
    !["", "income", "expense", "refund"].includes(filters.kind) ||
    !["", "overnight", "daycare", "monthly"].includes(filters.service) ||
    !["", "checked_in", "completed"].includes(filters.status) ||
    !["", "new", "returning", "registered", "first_booking"].includes(
      filters.segment,
    ) ||
    (filters.customer &&
      (!/^\d+$/.test(filters.customer) ||
        !Number.isSafeInteger(Number(filters.customer)) ||
        Number(filters.customer) < 1)) ||
    (filters.code && !/^\d{6}$/.test(filters.code))
  )
    return null;
  return {
    start,
    end,
    filters,
    lang: query.get("lang") === "en" ? "en" : "th",
    today: today.toISOString().slice(0, 10),
  };
}

export async function makeReport(db, name, options) {
  const { start, end, filters, lang, today } = options;
  const en = lang === "en";
  const label = (th, english) => (en ? english : th);
  const report = {
    name,
    title: reportNames[name][en ? 1 : 0],
    start,
    end,
    lang,
    filters,
    summary: [],
    columns: [],
    rows: [],
    groups: [],
    chart: null,
  };
  const column = (th, english, type = "text") => ({
    label: label(th, english),
    type,
  });
  const summary = (th, english, value, type = "number") => ({
    label: label(th, english),
    value,
    type,
  });
  const row = (values, type, id) => ({ values, link: { type, id } });
  const limited = (rows) => rows.length > rowLimit;
  const select = async (sql, ...values) =>
    (
      await db
        .prepare(sql)
        .bind(...values)
        .all()
    ).results;

  if (name === "finance") {
    const data = await select(
      `SELECT t.*,CAST(ROUND(t.amount*100) AS INTEGER) AS amount_cents,c.name AS customer FROM transactions t LEFT JOIN customers c ON c.id=t.customer_id
      WHERE occurred_on BETWEEN ? AND ? AND (?='' OR kind=?) AND (?='' OR category=?)
      ORDER BY occurred_on DESC,t.id DESC LIMIT ?`,
      start,
      end,
      filters.kind,
      filters.kind,
      filters.category,
      filters.category,
      rowLimit + 1,
    );
    if (limited(data)) return { ...report, error: "report_too_large" };
    const kinds = {
      income: label("รายรับ", "Income"),
      refund: label("เงินคืน", "Refunds"),
      expense: label("รายจ่าย", "Expenses"),
    };
    const totals = { income: 0, refund: 0, expense: 0 },
      methods = {},
      months = new Map();
    for (const item of data) {
      const amount = item.amount_cents;
      totals[item.kind] += amount;
      const month = item.occurred_on.slice(0, 7);
      if (!months.has(month))
        months.set(month, { income: 0, refund: 0, expense: 0 });
      months.get(month)[item.kind] += amount;
      if (item.kind === "income")
        methods[item.payment_type || "other"] =
          (methods[item.payment_type || "other"] || 0) + amount;
      const type = item.deposit_appointment_id
        ? "booking"
        : item.stay_id
          ? "stay"
          : "transaction";
      report.rows.push(
        row(
          [
            item.occurred_on,
            kinds[item.kind],
            item.description,
            item.customer || "—",
            amount,
          ],
          type,
          item.deposit_appointment_id || item.stay_id || item.id,
        ),
      );
    }
    report.columns = [
      column("วันที่รับหรือจ่าย", "Transaction date", "date"),
      column("ประเภท", "Type"),
      column("รายละเอียด", "Description"),
      column("ลูกค้า", "Customer"),
      column("ยอด (บาท)", "Amount (THB)", "money"),
    ];
    report.summary = Object.entries(kinds).map(([key, title]) => ({
      label: title,
      value: totals[key],
      type: "money",
    }));
    report.summary.push(
      summary(
        "เงินสุทธิ",
        "Net cash",
        totals.income - totals.refund - totals.expense,
        "money",
      ),
    );
    const paymentLabels = {
      deposit: label("มัดจำ", "Deposits"),
      checkin: label("รับวันเข้าพัก", "Check-in payments"),
      additional: label("รับเพิ่ม", "Additional payments"),
      other: label("รายรับอื่น", "Other income"),
    };
    report.groups.push({
      label: label("รายรับแยกตามการรับเงิน", "Income by payment type"),
      type: "money",
      items: Object.entries(paymentLabels).map(([key, title]) => [
        title,
        methods[key] || 0,
      ]),
    });
    report.chart = {
      type: "money",
      series: Object.values(kinds),
      months: [...months].sort().map(([month, values]) => ({
        month,
        values: Object.keys(kinds).map((key) => values[key]),
      })),
    };
    report.note = label(
      "อิงวันที่รับหรือจ่ายเงินจริง เงินสุทธิ = รายรับ − เงินคืน − รายจ่าย",
      "Uses cash transaction dates. Net cash = income − refunds − expenses.",
    );
  } else if (["balances", "boarding"].includes(name)) {
    const stayStatement = db
      .prepare(
        `SELECT s.id,s.stay_number,s.customer_id,s.status,s.agreed_total,c.name AS customer,
      COALESCE(date(s.actual_checkin_at,'+7 hours'),s.checkin) AS arrival,
      COALESCE(date(s.actual_checkout_at,'+7 hours'),CASE WHEN s.status='checked_in' THEN ? ELSE s.checkout END) AS departure,
      COALESCE(json_extract(CASE WHEN json_valid(s.intake) THEN s.intake ELSE '{}' END,'$.service_type'),'overnight') AS service,
      CASE WHEN s.payment_tracking=1 THEN ${stayBalance} ELSE 0 END AS due_cents,
      (SELECT group_concat(d.name,', ') FROM stay_dogs sd JOIN dogs d ON d.id=sd.dog_id WHERE sd.stay_id=s.id) AS dogs,
      (SELECT COUNT(*) FROM stay_dogs sd WHERE sd.stay_id=s.id) AS dog_count
      FROM stays s JOIN customers c ON c.id=s.customer_id
      WHERE s.status IN ('checked_in','completed') AND s.cancelled_at IS NULL AND arrival<=? AND departure>=?
      AND (?='' OR s.customer_id=?) AND (?='' OR service=?) AND (?='' OR s.status=?)
      ORDER BY arrival DESC,s.id DESC LIMIT ?`,
      )
      .bind(
        today,
        end,
        start,
        filters.customer,
        filters.customer,
        filters.service,
        filters.service,
        filters.status,
        filters.status,
        rowLimit + 1,
      );
    const pendingStatement = db
      .prepare(
        `SELECT a.id,a.booking_number,a.checkin,a.checkout,a.service_type,c.name AS customer,
      (SELECT group_concat(d.name,', ') FROM appointment_dogs ad JOIN dogs d ON d.id=ad.dog_id WHERE ad.appointment_id=a.id) AS dogs
      FROM appointments a JOIN customers c ON c.id=a.customer_id WHERE a.status='pending' AND a.stay_id IS NULL
      AND a.checkin<=? AND a.checkout>=? AND (?='' OR a.service_type=?) AND (?='' OR a.customer_id=?) AND ?=''
      ORDER BY a.checkin,a.id LIMIT ?`,
      )
      .bind(
        end,
        start,
        filters.service,
        filters.service,
        filters.customer,
        filters.customer,
        filters.status,
        rowLimit + 1,
      );
    const [staysResult, pendingResult] = await db.batch([
      stayStatement,
      pendingStatement,
    ]);
    const data = staysResult.results,
      pending = pendingResult.results;
    if (limited(data)) return { ...report, error: "report_too_large" };
    report.columns = [
      column("รายการ", "Record"),
      column("ลูกค้า", "Customer"),
      column("สุนัข", "Dogs"),
      column("เข้าพัก", "Arrival", "date"),
      column("รับกลับ", "Pickup", "date"),
      column("ประเภทบริการ", "Service"),
    ];
    const relevant =
      name === "balances" ? data.filter((item) => item.due_cents > 0) : data;
    for (const item of relevant) {
      const values = [
        item.stay_number || "#" + item.id,
        item.customer,
        item.dogs || "—",
        item.arrival,
        item.status === "completed" ? item.departure : null,
        (services[item.service] || services.overnight)[en ? 1 : 0],
      ];
      values.push(
        ...(name === "balances"
          ? [
              money(item.agreed_total),
              money(item.agreed_total) - item.due_cents,
              item.due_cents,
            ]
          : [
              item.status === "completed"
                ? label("กลับบ้านแล้ว", "Checked out")
                : label("เข้าพัก", "Checked in"),
            ]),
      );
      report.rows.push(row(values, "stay", item.id));
    }
    if (name === "balances") {
      report.columns.push(
        column("ยอดสุทธิ (บาท)", "Net (THB)", "money"),
        column("รับแล้ว (บาท)", "Paid (THB)", "money"),
        column("ค้างชำระ (บาท)", "Due (THB)", "money"),
      );
      report.summary = [
        summary(
          "ยอดค้างรวม (บาท)",
          "Total due (THB)",
          relevant.reduce((sum, item) => sum + item.due_cents, 0),
          "money",
        ),
        summary("รอบฝากค้างชำระ", "Outstanding stays", relevant.length),
        summary(
          "เจ้าของ",
          "Owners",
          new Set(relevant.map((item) => item.customer_id)).size,
        ),
      ];
      report.note = label(
        "ยอดค้างปัจจุบันของรอบฝากที่ทับช่วงวันที่เลือก เฉพาะบิลที่บันทึกยอดรับจริง",
        "Current balances for stays overlapping the selected period, where payments are tracked.",
      );
    } else {
      if (limited(pending) || data.length + pending.length > rowLimit)
        return { ...report, error: "report_too_large" };
      report.columns.push(column("สถานะ", "Status"));
      const months = new Map(),
        changes = new Map();
      let dogDays = 0,
        occupancy = 0,
        peak = 0,
        peakDay = null;
      for (const item of data) {
        const first = item.arrival > start ? item.arrival : start;
        const last = item.departure < end ? item.departure : end;
        if (first > last) continue;
        dogDays +=
          (Math.round((Date.parse(last) - Date.parse(first)) / 86400000) + 1) *
          item.dog_count;
        changes.set(first, (changes.get(first) || 0) + item.dog_count);
        const next = new Date(Date.parse(last) + 86400000)
          .toISOString()
          .slice(0, 10);
        changes.set(next, (changes.get(next) || 0) - item.dog_count);
        const month = first.slice(0, 7);
        if (!months.has(month))
          months.set(month, { overnight: 0, daycare: 0, monthly: 0 });
        months.get(month)[item.service] =
          (months.get(month)[item.service] || 0) + 1;
      }
      for (const [date, change] of [...changes].sort()) {
        occupancy += change;
        if (occupancy > peak) {
          peak = occupancy;
          peakDay = date;
        }
      }
      report.summary = [
        summary("รอเช็กอิน", "Pending bookings", pending.length),
        summary("รอบเข้าพักจริง", "Actual stays", data.length),
        summary(
          "สุนัข (ตัวต่อรอบ)",
          "Dogs across stays",
          data.reduce((sum, item) => sum + item.dog_count, 0),
        ),
        summary("วันเข้าพักรวม (ตัว-วัน)", "Dog-days", dogDays),
        summary("จำนวนสุนัขสูงสุดต่อวัน", "Peak dogs per day", peak),
      ];
      report.peakDay = peakDay;
      report.chart = {
        type: "number",
        series: Object.values(services).map((value) => value[en ? 1 : 0]),
        months: [...months].sort().map(([month, values]) => ({
          month,
          values: Object.keys(services).map((key) => values[key]),
        })),
      };
      report.rows.unshift(
        ...pending.map((item) =>
          row(
            [
              item.booking_number || "#" + item.id,
              item.customer,
              item.dogs || "—",
              item.checkin,
              item.checkout,
              (services[item.service_type] || services.overnight)[en ? 1 : 0],
              label("รอเช็กอิน", "Pending"),
            ],
            "booking",
            item.id,
          ),
        ),
      );
      report.note = label(
        "นับรอบที่ทับช่วงวันที่เลือก จำนวนตัว-วันและวันสูงสุดนับรวมวันรับกลับ กราฟจัดตามเดือนแรกของรอบในช่วงที่เลือก",
        "Counts overlapping stays. Dog-days and peak occupancy include pickup day. Chart uses the first month of each stay within the period.",
      );
    }
  } else if (name === "coupons") {
    const data = await select(
      `SELECT u.stay_id,u.discount_cents,u.used_at,s.checkin,s.agreed_total,
      s.discount_cents+s.rounding_cents AS total_discount,c.code,cu.name AS customer,
      COALESCE(date(u.used_at,'+7 hours'),s.checkin) AS report_day FROM coupon_uses u JOIN coupons c ON c.id=u.coupon_id
      JOIN stays s ON s.id=u.stay_id JOIN customers cu ON cu.id=s.customer_id
      WHERE s.status!='cancelled' AND s.cancelled_at IS NULL AND report_day BETWEEN ? AND ? AND (?='' OR c.code=?)
      ORDER BY report_day DESC,s.id DESC LIMIT ?`,
      start,
      end,
      filters.code,
      filters.code,
      rowLimit + 1,
    );
    if (limited(data)) return { ...report, error: "report_too_large" };
    const byCode = new Map();
    for (const item of data) {
      const entry = byCode.get(item.code) || { count: 0, amount: 0 };
      entry.count++;
      entry.amount += item.discount_cents;
      byCode.set(item.code, entry);
      report.rows.push(
        row(
          [
            item.report_day,
            item.used_at
              ? label("วันใช้สิทธิ์", "Redemption date")
              : label("วันเข้าพัก", "Arrival date"),
            item.code,
            item.customer,
            money(item.agreed_total) + item.total_discount,
            item.discount_cents,
            money(item.agreed_total),
          ],
          "stay",
          item.stay_id,
        ),
      );
    }
    report.columns = [
      column("วันที่", "Date", "date"),
      column("เกณฑ์วันที่", "Date basis"),
      column("รหัส", "Code"),
      column("ลูกค้า", "Customer"),
      column("ก่อนลด (บาท)", "Before discounts (THB)", "money"),
      column("คูปอง (บาท)", "Coupon (THB)", "money"),
      column("ยอดสุทธิ (บาท)", "Net (THB)", "money"),
    ];
    report.summary = [
      summary("จำนวนครั้งที่ใช้", "Redemptions", data.length),
      summary(
        "ส่วนลดคูปองรวม (บาท)",
        "Total coupon discounts (THB)",
        data.reduce((sum, item) => sum + item.discount_cents, 0),
        "money",
      ),
    ];
    report.groups = [
      {
        label: label("สรุปตามรหัสคูปอง", "By coupon code"),
        type: "money",
        items: [...byCode]
          .sort()
          .map(([code, value]) => [code + " · " + value.count, value.amount]),
      },
    ];
    report.note = label(
      "อิงวันที่ใช้สิทธิ์ รายการเดิมที่ไม่มีเวลาบันทึกใช้อ้างอิงจากวันเข้าพัก และไม่นับบิลที่ยกเลิก",
      "Uses redemption date, or arrival date for older records. Cancelled stays are excluded.",
    );
  } else {
    const data = await select(
      `WITH visits AS (
      SELECT customer_id,COALESCE(date(actual_checkin_at,'+7 hours'),checkin) AS arrival
      FROM stays WHERE status IN ('checked_in','completed') AND cancelled_at IS NULL
    ), totals AS (SELECT customer_id,MIN(arrival) AS first_visit,SUM(arrival BETWEEN ? AND ?) AS period_visits,COUNT(*) AS visits
      FROM visits WHERE arrival<=? GROUP BY customer_id
    ), bookings AS (SELECT customer_id,CASE WHEN COUNT(*)=COUNT(booked_at) THEN MIN(date(booked_at,'+7 hours')) END AS first_booking
      FROM appointments GROUP BY customer_id)
    SELECT c.id,c.name,date(c.registered_at,'+7 hours') AS registered,b.first_booking,t.first_visit,
      COALESCE(t.period_visits,0) AS period_visits,COALESCE(t.visits,0) AS visits FROM customers c
      LEFT JOIN totals t ON t.customer_id=c.id LEFT JOIN bookings b ON b.customer_id=c.id
      WHERE t.period_visits>0 OR registered BETWEEN ? AND ? OR b.first_booking BETWEEN ? AND ?
      ORDER BY period_visits DESC,c.name LIMIT ?`,
      start,
      end,
      end,
      start,
      end,
      start,
      end,
      rowLimit + 1,
    );
    if (limited(data)) return { ...report, error: "report_too_large" };
    const counts = { registered: 0, first_booking: 0, new: 0, returning: 0 };
    for (const item of data) {
      const flags = {
        registered: Boolean(
          item.registered && item.registered >= start && item.registered <= end,
        ),
        first_booking: Boolean(
          item.first_booking &&
            item.first_booking >= start &&
            item.first_booking <= end,
        ),
        new: Boolean(item.period_visits && item.first_visit >= start),
        returning: Boolean(item.period_visits && item.first_visit < start),
      };
      if (filters.segment && !flags[filters.segment]) continue;
      for (const key of Object.keys(counts)) counts[key] += Number(flags[key]);
      report.rows.push(
        row(
          [
            item.name,
            flags.new
              ? label("ฝากครั้งแรก", "First stay")
              : flags.returning
                ? label("กลับมาฝาก", "Returning")
                : "—",
            item.registered,
            item.first_booking,
            item.first_visit,
            item.period_visits,
            item.visits,
          ],
          "customer",
          item.id,
        ),
      );
    }
    report.columns = [
      column("ลูกค้า", "Customer"),
      column("กลุ่ม", "Segment"),
      column("เพิ่มโปรไฟล์", "Profile created", "date"),
      column("จองครั้งแรก", "First booking", "date"),
      column("ฝากครั้งแรก", "First stay", "date"),
      column("รอบฝากในช่วง", "Stays in period", "number"),
      column("รอบฝากถึงวันสิ้นสุด", "Stays through period end", "number"),
    ];
    report.summary = [
      summary("เพิ่มโปรไฟล์", "Profiles created", counts.registered),
      summary("จองครั้งแรก", "First bookings", counts.first_booking),
      summary("ฝากครั้งแรก", "First stays", counts.new),
      summary("กลับมาฝาก", "Returning customers", counts.returning),
    ];
    report.note = label(
      "ข้อมูลเดิมที่ไม่ทราบวันเพิ่มโปรไฟล์หรือวันจองครั้งแรกจะแสดงเป็นขีด วันเข้าพักของรายการเดิมอิงวันที่ในรายการฝาก",
      "A dash indicates an unavailable profile or first booking date. Older stays use their recorded arrival date.",
    );
  }
  return report;
}

export async function reportChoices(db) {
  const [customers, categories] = await db.batch([
    db
      .prepare("SELECT id,name FROM customers ORDER BY name,id LIMIT 5000")
      .bind(),
    db
      .prepare("SELECT DISTINCT category FROM transactions ORDER BY category")
      .bind(),
  ]);
  return {
    customers: customers.results,
    categories: categories.results.map((row) => row.category),
  };
}
