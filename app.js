const UNITS = [
  {
    id: "hl1042",
    ref: "HL-1042",
    title: "Dunajská 18 · 2 bed",
    city: "BA",
    cityLabel: "Bratislava",
    district: "Petržalka",
    beds: 2,
    rent: 1190,
    available: "1 Oct 2026",
    landlord: "Dunajská Residence s.r.o.",
    energy: "B",
    compliance: "AML pack required before keys. No cash deposit.",
    slots: ["Tue 16 Sep · 10:00", "Tue 16 Sep · 17:30", "Wed 17 Sep · 09:00"],
  },
  {
    id: "hl1108",
    ref: "HL-1108",
    title: "Kapucínska 4 · studio",
    city: "BA",
    cityLabel: "Bratislava",
    district: "Staré Mesto",
    beds: 0,
    rent: 780,
    available: "15 Sep 2026",
    landlord: "Old Town Lets",
    energy: "C",
    compliance: "Short let. Viewing only with photo ID.",
    slots: ["Mon 15 Sep · 12:00", "Thu 18 Sep · 18:00"],
  },
  {
    id: "hl2210",
    ref: "HL-2210",
    title: "Ungargasse 9 · 2 bed",
    city: "VIE",
    cityLabel: "Vienna",
    district: "Landstraße",
    beds: 2,
    rent: 1640,
    available: "1 Nov 2026",
    landlord: "Wien Haus GmbH",
    energy: "A",
    compliance: "Maklergesetz disclosure on file. Deposit via escrow only.",
    slots: ["Fri 19 Sep · 11:00"],
  },
];

const panels = {
  inventory: document.getElementById("panel-inventory"),
  detail: document.getElementById("panel-detail"),
  pipeline: document.getElementById("panel-pipeline"),
  apply: document.getElementById("panel-apply"),
};

const navButtons = [...document.querySelectorAll("[data-nav]")];
let activeUnit = UNITS[0];
const caseState = {
  unitId: null,
  slot: "",
  status: "",
  applicant: "",
};

function showPanel(name) {
  for (const [key, el] of Object.entries(panels)) {
    const on = key === name;
    el.classList.toggle("hidden", !on);
    el.hidden = !on;
  }
  for (const btn of navButtons) {
    const on =
      btn.dataset.nav === name || (name === "detail" && btn.dataset.nav === "inventory");
    btn.setAttribute("aria-current", on ? "page" : "false");
  }
}

function matchesFilter(unit) {
  const city = document.getElementById("select-city").value;
  const beds = Number(document.getElementById("select-beds").value);
  const maxRent = Number(document.getElementById("input-max-rent").value) || Infinity;
  if (city !== "all" && unit.city !== city) return false;
  if (unit.beds < beds) return false;
  if (unit.rent > maxRent) return false;
  return true;
}

function renderInventory() {
  const list = document.getElementById("list-inventory");
  const hits = UNITS.filter(matchesFilter);
  document.getElementById("lbl-result-count").textContent = `${hits.length} unit${
    hits.length === 1 ? "" : "s"
  } in filter`;
  list.innerHTML = "";
  for (const unit of hits) {
    const card = document.createElement("article");
    card.className = "card";
    card.id = `card-unit-${unit.id}`;
    card.innerHTML = `
      <p class="ref">${unit.ref}</p>
      <h2>${unit.title}</h2>
      <p class="meta">€${unit.rent.toLocaleString("en-GB")} / month · ${unit.district} · from ${unit.available}</p>
      <button type="button" id="btn-open-${unit.id}" aria-label="Open ${unit.ref}">Open ${unit.ref}</button>
    `;
    list.appendChild(card);
    card.querySelector("button").addEventListener("click", () => openUnit(unit.id));
  }
}

function openUnit(id) {
  activeUnit = UNITS.find((u) => u.id === id);
  document.getElementById("lbl-detail-ref").textContent = activeUnit.ref;
  document.getElementById("heading-detail").textContent = activeUnit.title;
  document.getElementById("list-detail-facts").innerHTML = `
    <dt>City</dt><dd>${activeUnit.cityLabel}</dd>
    <dt>District</dt><dd>${activeUnit.district}</dd>
    <dt>Rent</dt><dd>€${activeUnit.rent.toLocaleString("en-GB")} / month</dd>
    <dt>Available</dt><dd>${activeUnit.available}</dd>
    <dt>Landlord</dt><dd>${activeUnit.landlord}</dd>
    <dt>EPC</dt><dd>${activeUnit.energy}</dd>
  `;
  document.getElementById("lbl-compliance").textContent = activeUnit.compliance;
  const slot = document.getElementById("select-slot");
  slot.innerHTML = activeUnit.slots
    .map((s, i) => `<option value="${s}" ${i === 0 ? "selected" : ""}>${s}</option>`)
    .join("");
  document.getElementById("lbl-viewing-confirm").hidden = true;
  document.getElementById("btn-start-application").hidden = true;
  showPanel("detail");
}

function renderPipeline() {
  const empty = document.getElementById("lbl-pipeline-empty");
  const card = document.getElementById("card-case");
  if (!caseState.unitId) {
    empty.hidden = false;
    card.hidden = true;
    card.classList.add("hidden");
    return;
  }
  const unit = UNITS.find((u) => u.id === caseState.unitId);
  empty.hidden = true;
  card.hidden = false;
  card.classList.remove("hidden");
  document.getElementById("lbl-case-ref").textContent = unit.ref;
  document.getElementById("heading-case-unit").textContent = unit.title;
  document.getElementById("lbl-case-status").textContent = caseState.status;
  document.getElementById("lbl-case-next").textContent = caseState.slot
    ? `Viewing ${caseState.slot}`
    : "";
}

document.getElementById("form-search").addEventListener("submit", (event) => {
  event.preventDefault();
  renderInventory();
});

document.getElementById("btn-back-inventory").addEventListener("click", () => {
  showPanel("inventory");
});

document.getElementById("btn-book-viewing").addEventListener("click", () => {
  const slot = document.getElementById("select-slot").value;
  caseState.unitId = activeUnit.id;
  caseState.slot = slot;
  caseState.status = "Viewing booked";
  const confirm = document.getElementById("lbl-viewing-confirm");
  confirm.textContent = `Viewing held: ${slot} · ${activeUnit.ref}`;
  confirm.hidden = false;
  const start = document.getElementById("btn-start-application");
  start.hidden = false;
  renderPipeline();
});

document.getElementById("btn-start-application").addEventListener("click", () => {
  document.getElementById("lbl-apply-unit").textContent =
    `${activeUnit.ref} · ${activeUnit.title}`;
  showPanel("apply");
});

document.getElementById("form-application").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = document.getElementById("input-legal-name").value.trim();
  const email = document.getElementById("input-email").value.trim();
  const income = document.getElementById("input-income").value;
  const employment = document.getElementById("select-employment").value;
  const occupants = document.getElementById("input-occupants").value;
  const ok = document.getElementById("chk-accuracy").checked;
  const err = document.getElementById("lbl-apply-error");
  if (!name || !email || !income || !employment || !occupants || !ok) {
    err.hidden = false;
    return;
  }
  err.hidden = true;
  caseState.applicant = name;
  caseState.status = "Awaiting holding deposit";
  caseState.unitId = activeUnit.id;
  document.getElementById("lbl-deposit-ref").textContent = `${activeUnit.ref} · ${name}`;
  const deposit = document.getElementById("panel-deposit");
  deposit.hidden = false;
  deposit.classList.remove("hidden");
  renderPipeline();
});

document.getElementById("btn-pay-deposit").addEventListener("click", () => {
  document.getElementById("lbl-deposit-status").textContent = "Deposit recorded (demo)";
  caseState.status = "Deposit recorded (demo)";
  renderPipeline();
});

for (const btn of navButtons) {
  btn.addEventListener("click", () => {
    if (btn.dataset.nav === "pipeline") renderPipeline();
    if (btn.dataset.nav === "apply" && activeUnit) {
      document.getElementById("lbl-apply-unit").textContent =
        `${activeUnit.ref} · ${activeUnit.title}`;
    }
    showPanel(btn.dataset.nav);
  });
}

renderInventory();
showPanel("inventory");
