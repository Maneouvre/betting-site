let currentUser = null;
let fixtures = [];
let bets = [];
let adminBets = [];
let sendMoneyBands = [];
let managerFeePercent = 10;
let tariffNotice = "";
let activeBetFilter = "all";
let fixtureFilter = "all";
let refreshTimer = null;

async function api(action, values = {}) {
  const response = await fetch("api.php", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...values })
  });
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error("The server returned an invalid response. Check the PHP error log.");
  }
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function money(value) {
  return `KES ${Number(value || 0).toLocaleString("en-KE")}`;
}

function estimateSendMoneyFee(amount) {
  const band = sendMoneyBands.find(item => amount >= item.min && amount <= item.max);
  return band ? Number(band.fee) : null;
}

function payoutBreakdown(stake) {
  const gross = Number(stake) * 2;
  const managerFee = Math.round(gross * managerFeePercent / 100);
  const available = gross - managerFee;
  let payout = null;
  let sendMoneyFee = null;
  if (available <= 250000) {
    sendMoneyBands.forEach(band => {
      const candidate = Math.min(Number(band.max), available - Number(band.fee));
      if (candidate >= Number(band.min) && candidate + Number(band.fee) <= available && (payout === null || candidate > payout)) {
        payout = candidate;
        sendMoneyFee = Number(band.fee);
      }
    });
  }
  return { gross, managerFee, payout, sendMoneyFee };
}

function payoutText(amount) {
  return amount === null ? "Tariff unavailable" : money(amount);
}

function transferFeeLabel(amount) {
  const fee = estimateSendMoneyFee(amount);
  return fee === null ? "Not in supplied tariff bands" : money(fee);
}

function shortDate(timestamp) {
  return new Intl.DateTimeFormat("en-KE", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

function timeToKickoff(timestamp) {
  const minutes = Math.max(0, Math.floor((timestamp - Date.now()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ${hours % 24} hr`;
}

function fixtureById(id) {
  return fixtures.find(fixture => fixture.id === id);
}

function showToast(message, isError = false) {
  const region = document.getElementById("toast-region");
  if (!region) return;
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " error" : ""}`;
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function runSafely(task) {
  return task().catch(error => showToast(error.message || "The request could not be completed.", true));
}

function setActiveView(name) {
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === `view-${name}`));
  document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === name));
  if (name === "my-bets") runSafely(refreshBets);
  if (name === "admin") runSafely(refreshAdmin);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function requireAccount() {
  if (currentUser) return true;
  openAccountModal("register");
  showToast("Create an account to place a bet.");
  return false;
}

async function refreshBets() {
  if (!currentUser) {
    bets = [];
  } else {
    const data = await api("bets.list");
    bets = data.bets;
  }
  renderMyBets();
  renderAccount();
}

async function refreshAdmin() {
  const data = await api("admin.dashboard");
  adminBets = data.bets;
  renderAdmin();
}

function renderFixtures() {
  const grid = document.getElementById("fixture-grid");
  const now = Date.now();
  const visible = fixtures.filter(fixture => {
    if (fixture.starts - now <= 30 * 60 * 1000) return false;
    if (fixtureFilter === "today") return new Date(fixture.starts).toDateString() === new Date().toDateString();
    if (fixtureFilter === "tomorrow") {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return new Date(fixture.starts).toDateString() === tomorrow.toDateString();
    }
    return true;
  });
  if (!visible.length) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">◷</div><strong>No sample fixtures in this window</strong><p>Try another filter. Live fixtures require a connected sports data provider.</p></div>';
    return;
  }
  grid.innerHTML = visible.map(fixture => `
    <article class="fixture-card">
      <div class="fixture-card-top"><span>${escapeHtml(fixture.league)}</span><span class="sample-label">SAMPLE</span></div>
      <div class="team-row">
        <div class="team"><span class="team-crest">${escapeHtml(fixture.homeCode)}</span><span class="team-name">${escapeHtml(fixture.home)}</span></div>
        <span class="versus">VS</span>
        <div class="team"><span class="team-crest">${escapeHtml(fixture.awayCode)}</span><span class="team-name">${escapeHtml(fixture.away)}</span></div>
      </div>
      <div class="fixture-footer"><span class="fixture-time"><strong>${escapeHtml(shortDate(fixture.starts))}</strong><br>In ${escapeHtml(timeToKickoff(fixture.starts))}</span><button class="fixture-bet-button" data-bet-fixture="${escapeHtml(fixture.id)}">Find a mate →</button></div>
    </article>`).join("");
}

function openModal(contents, wide = false) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-backdrop" data-close-backdrop><section class="modal${wide ? " modal-wide" : ""}" role="dialog" aria-modal="true">${contents}</section></div>`;
  root.querySelector(".modal-close")?.addEventListener("click", closeModal);
  root.querySelector(".modal-backdrop").addEventListener("click", event => {
    if (event.target.hasAttribute("data-close-backdrop")) closeModal();
  });
}

function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

function openAccountModal(mode) {
  const isRegister = mode === "register";
  openModal(`
    <button class="modal-close" aria-label="Close">×</button>
    <div class="eyebrow"><span class="eyebrow-line"></span> ${isRegister ? "JOIN MATCHMATE" : "WELCOME BACK"}</div>
    <h2>${isRegister ? "Create your player account." : "Sign in to your account."}</h2>
    <p class="modal-intro">${isRegister ? "Register to receive a unique account number. Use a strong password; real payments are not connected in this prototype." : "Sign in with the registration number and password you created."}</p>
    <form class="modal-form" id="account-form">
      ${isRegister ? `
        <label>Full name<input class="form-control" name="name" autocomplete="name" required maxlength="100" placeholder="Your registered name"></label>
        <label>M-Pesa number<small>Shown to the admin for manual payout follow-up</small><input class="form-control" name="phone" autocomplete="tel" required inputmode="tel" maxlength="24" placeholder="+254 7XX XXX XXX"></label>
        <label>Password<small>At least 8 characters; stored as a PHP password hash</small><input class="form-control" name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="200"></label>
        <label class="check-row"><input type="checkbox" name="consent" required><span>I understand this is a prototype. It does not collect or transfer real money.</span></label>
      ` : `
        <label>Registration account number<input class="form-control" name="account" required maxlength="24" placeholder="MM-2026-12345"></label>
        <label>Password<input class="form-control" name="password" type="password" autocomplete="current-password" required maxlength="200"></label>
      `}
      <button class="primary-button" type="submit">${isRegister ? "Register & get account number" : "Sign in"} <span>→</span></button>
      <button class="text-button" type="button" id="switch-account">${isRegister ? "Already registered? Sign in" : "New player? Create an account"}</button>
    </form>`);
  document.getElementById("switch-account").addEventListener("click", () => openAccountModal(isRegister ? "login" : "register"));
  document.getElementById("account-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const action = isRegister ? "auth.register" : "auth.login";
      const values = isRegister
        ? { name: String(form.get("name") || "").trim(), phone: String(form.get("phone") || "").trim(), password: String(form.get("password") || "") }
        : { account: String(form.get("account") || "").trim(), password: String(form.get("password") || "") };
      const response = await api(action, values);
      currentUser = response.user;
      await refreshBets();
      closeModal();
      if (isRegister) openRegistrationComplete(response.user.account);
      showToast(isRegister ? "Your account is ready." : "Signed in.");
    } catch (error) {
      showToast(error.message, true);
      submit.disabled = false;
    }
  });
}

function openRegistrationComplete(account) {
  openModal(`
    <button class="modal-close" aria-label="Close">×</button>
    <div class="eyebrow"><span class="eyebrow-line"></span> ACCOUNT CREATED</div>
    <h2>Your registration number.</h2>
    <p class="modal-intro">Keep this number for signing in and for any winner payout messages.</p>
    <div class="demo-payment-box">PLAYER ACCOUNT<br><strong>${escapeHtml(account)}</strong></div>
    <button class="primary-button full-button" id="account-continue">Continue to MatchMate <span>→</span></button>`);
  document.getElementById("account-continue").addEventListener("click", closeModal);
}

function renderAccount() {
  document.getElementById("sidebar-name").textContent = currentUser ? currentUser.name : "Guest player";
  document.getElementById("sidebar-account").textContent = currentUser ? currentUser.account : "Register to get started";
  document.getElementById("sidebar-avatar").textContent = currentUser ? currentUser.name.slice(0, 1).toUpperCase() : "?";
  document.getElementById("top-account-button").innerHTML = currentUser ? "My bets <span>↗</span>" : "Sign in <span>↗</span>";
  document.getElementById("my-bets-count").textContent = bets.length;
  document.querySelectorAll('[data-view="admin"], .admin-label').forEach(item => {
    item.hidden = currentUser?.role !== "admin";
  });
}

function openFootballBet(fixtureId) {
  if (!requireAccount()) return;
  const fixture = fixtureById(fixtureId);
  if (!fixture || fixture.starts - Date.now() <= 30 * 60 * 1000) {
    showToast("Football betting is closed 30 minutes before kick-off.", true);
    renderFixtures();
    return;
  }
  openModal(`
    <button class="modal-close" aria-label="Close">×</button>
    <div class="eyebrow"><span class="eyebrow-line"></span> FOOTBALL · SAMPLE FIXTURE</div>
    <h2>${escapeHtml(fixture.home)} vs ${escapeHtml(fixture.away)}</h2>
    <p class="modal-intro">${escapeHtml(shortDate(fixture.starts))} · Bets close 30 minutes before kick-off. Matching requires the same fixture, equal stake, and a different prediction.</p>
    <form class="modal-form" id="football-form">
      <label>Your prediction<select class="form-control" name="pick" required>
        <option value="${escapeHtml(fixture.home)}">${escapeHtml(fixture.home)} to win</option>
        <option value="${escapeHtml(fixture.away)}">${escapeHtml(fixture.away)} to win</option>
        <option value="Draw">Draw</option>
      </select></label>
      <label>Stake amount · KES · minimum 50<input class="form-control" name="stake" type="number" min="50" step="1" value="500" required></label>
      <div class="modal-summary"><span>Final amount to expect after fees</span><strong id="football-payout">KES 887</strong></div>
      <div class="demo-payment-box"><strong>Same fixture + same stake.</strong> Payment is available only after another account is matched. No match? No payment request.</div>
      <button class="primary-button" type="submit">Find a matching player <span>→</span></button>
    </form>`);
  const form = document.getElementById("football-form");
  form.elements.stake.addEventListener("input", () => {
    document.getElementById("football-payout").textContent = payoutText(payoutBreakdown(Number(form.elements.stake.value)).payout);
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    runSafely(async () => {
      const response = await api("bets.create", {
        type: "football",
        fixtureId,
        pick: form.elements.pick.value,
        stake: Number(form.elements.stake.value)
      });
      closeModal();
      await refreshBets();
      setActiveView("my-bets");
      if (response.matched) {
        showToast("Football opponent found. Continue with the payment steps.");
        openPaymentModal(response.bet.id);
      } else {
        showToast("Request posted. No matching player yet; no payment is due.");
      }
    });
  });
}

async function openKonamiChallenge() {
  if (!requireAccount()) return;
  const stake = Number(document.getElementById("konami-stake").value);
  try {
    const response = await api("bets.create", { type: "konami", stake });
    await refreshBets();
    setActiveView("my-bets");
    if (response.matched) {
      showToast("eFootball opponent found. Continue with the payment steps.");
      openPaymentModal(response.bet.id);
    } else {
      showToast("Challenge posted. No matching player yet; no payment is due.");
    }
  } catch (error) {
    showToast(error.message, true);
  }
}

function openPaymentModal(betId) {
  const bet = bets.find(item => String(item.id) === String(betId));
  if (!bet || bet.status !== "awaiting_payment" || !bet.opponent) return;
  const isKonami = bet.type === "konami";
  openModal(`
    <button class="modal-close" aria-label="Close">×</button>
    <div class="eyebrow"><span class="eyebrow-line"></span> MATCH FOUND</div>
    <h2>${isKonami ? "Your eFootball mate is ready." : "You’ve got a football mate."}</h2>
    <p class="modal-intro">${isKonami ? "Both players must submit a payment reference within 5 minutes. The admin checks it manually; after approval you can share a fresh eFootball room code." : "Submit a payment reference before the fixture closes, 30 minutes before kick-off. The admin checks it manually."}</p>
    <div class="modal-summary"><span>Your stake</span><strong>${money(bet.stake)}</strong></div>
    <div class="modal-summary"><span>Opponent</span><strong>${escapeHtml(bet.opponent.name)} · ${escapeHtml(bet.opponent.account)}</strong></div>
    <div class="demo-payment-box"><strong>Prototype:</strong> Do not send real money. In a live service, this step would record an M-Pesa payment made outside the site; admin would verify its reference manually.</div>
    <form class="modal-form" id="payment-form">
    <label>Payment method<select class="form-control" name="paymentMethod" required><option value="send_money">M-Pesa Send Money</option><option value="till">Till / Buy Goods</option></select></label>
    <div class="modal-summary"><span id="stake-fee-label">Estimated Send Money fee on your stake</span><strong id="stake-fee-value">${transferFeeLabel(bet.stake)}</strong></div>
    <label>M-Pesa transaction reference<input class="form-control" name="paymentReference" required minlength="6" maxlength="40" pattern="[A-Za-z0-9-]{6,40}" placeholder="For example, QWE12RTY34"></label>
    <div class="demo-payment-box">The Send Money charge on this stake is separate. The estimated fee for sending the eventual prize is deducted before the final payout is shown. Till charges were not supplied. Admin must check the actual reference.</div>
    <button class="primary-button" type="submit">Submit reference for approval <span>→</span></button>
    </form>`);
  const paymentMethod = document.querySelector('#payment-form [name="paymentMethod"]');
  const updateStakeFee = () => {
    const isSendMoney = paymentMethod.value === "send_money";
    document.getElementById("stake-fee-label").textContent = isSendMoney ? "Estimated Send Money fee on your stake" : "Till / Buy Goods fee";
    document.getElementById("stake-fee-value").textContent = isSendMoney ? transferFeeLabel(bet.stake) : "Not provided";
  };
  paymentMethod.addEventListener("change", updateStakeFee);
  document.getElementById("payment-form").addEventListener("submit", event => {
    event.preventDefault();
    runSafely(async () => {
    const form = new FormData(event.currentTarget);
    const paymentReference = String(form.get("paymentReference") || "").trim();
    const method = String(form.get("paymentMethod") || "");
    await api("bets.pay", { betId, paymentReference, paymentMethod: method });
      closeModal();
      await refreshBets();
      await refreshAdminIfVisible();
      showToast(isKonami ? "Reference submitted. Admin approval is required before sharing your room code." : "Reference submitted for manual admin approval.");
    });
  });
}

function openCodeModal(betId) {
  openModal(`
    <button class="modal-close" aria-label="Close">×</button>
    <div class="eyebrow"><span class="eyebrow-line"></span> PAYMENT STEP RECORDED</div>
    <h2>Share your eFootball room code.</h2>
    <p class="modal-intro">Enter a new room or invite code for this round. Both matched players must have their payment approved and share their codes before play.</p>
    <form class="modal-form" id="code-form">
      <label>Room / invite code<input class="form-control" name="code" required maxlength="40" placeholder="Enter your eFootball room code"></label>
      <div class="demo-payment-box">The code is visible to the matched opponent and admin. The site does not connect to Konami; share a fresh code for every rematch.</div>
      <button class="primary-button" type="submit">Send code &amp; get ready <span>→</span></button>
    </form>`);
  document.getElementById("code-form").addEventListener("submit", event => {
    event.preventDefault();
    const roomCode = String(new FormData(event.currentTarget).get("code") || "").trim();
    runSafely(async () => {
      await api("bets.code", { betId, roomCode });
      closeModal();
      await refreshBets();
      await refreshAdminIfVisible();
      showToast("Room code submitted. Play one game, then report the result.");
    });
  });
}

function openResultReportModal(bet) {
  if (bet.myReport) {
    showToast("You already sent your result for this one-game match.");
    return;
  }
  openModal(`
    <button class="modal-close" aria-label="Close">×</button>
    <div class="eyebrow"><span class="eyebrow-line"></span> eFOOTBALL · ONE GAME</div>
    <h2>Report your match result.</h2>
    <p class="modal-intro">Choose your result and optionally enter the final score. Your opponent must submit their result too. Matching reports identify the agreed winner; conflicting reports go to the admin.</p>
    <form class="modal-form" id="report-form">
      <label>My result<select class="form-control" name="result" required>
        <option value="win">I won</option><option value="loss">My opponent won</option><option value="tie">Draw / no winner</option>
      </select></label>
      <label>Final score <small>Optional</small><input class="form-control" name="score" maxlength="40" placeholder="For example, 2–1"></label>
      <div class="demo-payment-box">Room codes do not provide a verified game result. Do not report a false result; the admin can review both claims.</div>
      <button class="primary-button" type="submit">Submit my result <span>→</span></button>
    </form>`);
  document.getElementById("report-form").addEventListener("submit", event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    runSafely(async () => {
      await api("reports.submit", { betId: bet.id, result: form.get("result"), score: String(form.get("score") || "").trim() });
      closeModal();
      await refreshBets();
      await refreshAdminIfVisible();
      showToast("Result submitted. The other player must also report.");
    });
  });
}

function statusLabel(status) {
  return ({
    open: "Looking for a mate",
    awaiting_payment: "Payment · admin review",
    awaiting_code: "Payment approved · code",
    paid: "Ready / result due",
    won: "Winner · payout due",
    lost: "Not the winner",
    tie: "Tie · refund due",
    refunded: "Refund marked sent",
    completed: "Payout sent",
    cancelled: "Cancelled"
  })[status] || status;
}

function resultLabel(result) {
  return ({ win: "Player reports: win", loss: "Player reports: loss", tie: "Player reports: tie" })[result] || "Not reported";
}

function renderMyBets() {
  const list = document.getElementById("my-bets-list");
  const filtered = bets.filter(bet => activeBetFilter === "all" ||
    (activeBetFilter === "active" && ["open", "awaiting_payment", "awaiting_code", "paid"].includes(bet.status)) ||
    (activeBetFilter === "won" && ["won", "completed"].includes(bet.status)));
  document.getElementById("bet-summary").textContent = `${bets.length} bet${bets.length === 1 ? "" : "s"} total`;
  const totalStaked = bets.reduce((sum, bet) => sum + Number(bet.stake), 0);
  const dueBets = bets.filter(bet => bet.status === "won");
  const payoutDue = dueBets.reduce((sum, bet) => sum + Number(bet.payout || 0), 0);
  const paidOut = bets.filter(bet => bet.status === "completed").reduce((sum, bet) => sum + Number(bet.payout), 0);
  document.getElementById("player-totals").innerHTML = `
    <div class="player-total-card"><span>TOTAL STAKES · ALL ROUNDS</span><strong>${money(totalStaked)}</strong></div>
    <div class="player-total-card due"><span>PAYOUT DUE</span><strong>${dueBets.some(bet => bet.payout === null) ? "Tariff unavailable" : money(payoutDue)}</strong></div>
    <div class="player-total-card"><span>PAID OUT</span><strong>${money(paidOut)}</strong></div>`;
  const feeNotice = document.getElementById("fee-notice");
  if (feeNotice) feeNotice.textContent = tariffNotice;
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">▤</div><strong>${bets.length ? "Nothing in this filter yet" : "Your first match starts here"}</strong><p>${bets.length ? "Try another filter to see your bets." : "Choose a football fixture or find an eFootball opponent. Payment is available only after a real account is matched."}</p><button class="primary-button" data-empty-play>Explore matches <span>→</span></button></div>`;
    list.querySelector("[data-empty-play]").addEventListener("click", () => setActiveView("football"));
    return;
  }
  list.innerHTML = filtered.map(bet => {
    const title = bet.type === "konami" ? "eFootball · one game" : `${bet.home || "Football"} vs ${bet.away || "fixture"}`;
    const detail = bet.type === "konami" ? "Konami eFootball app" : `${bet.pick} · ${bet.kickoff ? shortDate(bet.kickoff) : "sample fixture"}`;
    const action = bet.status === "awaiting_payment" && !bet.userPaid ? `<button class="fixture-bet-button" data-pay="${escapeHtml(bet.id)}">Add payment reference →</button>` :
      bet.status === "awaiting_code" ? `<button class="fixture-bet-button" data-code="${escapeHtml(bet.id)}">Send room code →</button>` :
      bet.type === "konami" && bet.status === "paid" && !bet.myReport ? `<button class="fixture-bet-button" data-report="${escapeHtml(bet.id)}">Report result →</button>` :
      bet.status === "open" ? `<button class="fixture-bet-button" data-cancel="${escapeHtml(bet.id)}">Cancel request</button>` : "";
    const reportInfo = bet.type === "konami" && bet.status === "paid"
      ? `<div class="bet-card-sub">${escapeHtml(resultLabel(bet.myReport))} · ${escapeHtml(bet.opponentReport ? "Opponent reported" : "Waiting for opponent result")}</div>` : "";
    const breakdown = payoutBreakdown(bet.stake);
    const payout = ["won", "completed"].includes(bet.status)
      ? `<div class="bet-meta"><span class="bet-meta-label">FINAL PAYOUT · AFTER ALL FEES</span><strong style="color:var(--green)">${payoutText(bet.payout)}</strong><span class="bet-card-sub">Manager ${money(bet.managerFee)} · Send Money ${bet.payoutSendMoneyFee === null ? "n/a" : money(bet.payoutSendMoneyFee)}</span></div>`
      : `<div class="bet-meta"><span class="bet-meta-label">FINAL AMOUNT TO EXPECT</span><strong>${payoutText(breakdown.payout)}</strong><span class="bet-card-sub">Gross ${money(breakdown.gross)} · Manager ${money(breakdown.managerFee)} · Send Money ${breakdown.sendMoneyFee === null ? "n/a" : money(breakdown.sendMoneyFee)}</span></div>`;
    const paymentInfo = bet.userPaid ? `<div class="bet-card-sub">${bet.paymentApproved ? "Payment approved by admin" : "Payment reference submitted · awaiting admin approval"}</div>` : "";
    return `<article class="bet-card">
      <div><div class="bet-card-title">${escapeHtml(title)}</div><div class="bet-card-sub">${escapeHtml(detail)}${bet.opponent ? ` · vs ${escapeHtml(bet.opponent.name)}` : " · Waiting for an equal-stake opponent"}</div>${reportInfo}</div>
      <div class="bet-meta"><span class="bet-meta-label">YOUR STAKE</span><strong>${money(bet.stake)}</strong></div>
      ${payout}
      <div><span class="status-badge status-${escapeHtml(bet.status)}">${escapeHtml(statusLabel(bet.status))}</span>${paymentInfo}<div style="margin-top:8px">${action}</div></div>
    </article>`;
  }).join("");
}

function whatsappLink(phone, message) {
  const digits = String(phone || "").replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function smsLink(phone, message) {
  return `sms:${encodeURIComponent(phone || "")}?body=${encodeURIComponent(message)}`;
}

function winnerRow(bet) {
  const winner = bet.player;
  const opponent = bet.opponent || { name: "Opponent", account: "—" };
  const message = `Hello ${winner.name}, your MatchMate ${bet.type === "konami" ? "eFootball" : "football"} win has been sent manually. Account: ${winner.account}. Bet: ${money(bet.stake)}. Manager fee: ${money(bet.managerFee)}. Amount sent: ${payoutText(bet.payout)}. Opponent: ${opponent.name}.`;
  return `<tr>
    <td><div class="person-cell"><strong>${escapeHtml(winner.name)}</strong><small>${escapeHtml(winner.account)}</small></div></td>
    <td><div class="person-cell"><strong>${escapeHtml(opponent.name)}</strong><small>${escapeHtml(opponent.account)}</small></div></td>
    <td>${money(bet.stake)}<br><small class="bet-card-sub">${escapeHtml(bet.type === "konami" ? "eFootball" : `${bet.home || ""} vs ${bet.away || ""}`)}</small></td>
    <td>${money(bet.managerFee)}<br><small class="bet-card-sub">${bet.managerFeePercent}% of pot</small></td>
    <td class="money-cell">${payoutText(bet.payout)}</td>
    <td>${bet.payoutSendMoneyFee === null ? "Not in bands" : money(bet.payoutSendMoneyFee)}<br><small class="bet-card-sub">deducted before payout</small></td>
    <td><div class="person-cell"><strong>${escapeHtml(winner.name)}</strong><small>${escapeHtml(winner.phone)}</small></div></td>
    <td><span class="status-badge status-${escapeHtml(bet.status)}">${bet.status === "completed" ? "Sent" : "Payout due"}</span></td>
    <td>${bet.status === "won" && bet.payout !== null ? `<a class="table-action" href="${escapeHtml(whatsappLink(winner.phone, message))}" target="_blank" rel="noopener">WhatsApp</a> <a class="table-action" href="${escapeHtml(smsLink(winner.phone, message))}">SMS</a> <button class="table-action" data-mark-sent="${escapeHtml(bet.id)}">Mark sent</button>` : ""}</td>
  </tr>`;
}

function claimsAgree(bet, other) {
  if (bet.myReport === "tie" && other?.myReport === "tie") return "Tie reported by both";
  if (bet.myReport === "win" && other?.myReport === "loss") return `${bet.player.name} reported winner`;
  if (bet.myReport === "loss" && other?.myReport === "win") return `${other.player.name} reported winner`;
  if (bet.myReport && other?.myReport) return "Reports disagree";
  return bet.myReport || other?.myReport ? "Waiting for both reports" : "Not reported";
}

function renderAdmin() {
  const winners = adminBets.filter(bet => ["won", "completed"].includes(bet.status));
  const awaiting = adminBets.filter(bet => bet.userPaid && !bet.paymentApproved);
  const open = adminBets.filter(bet => bet.status === "open");
  document.getElementById("admin-open").textContent = open.length;
  document.getElementById("admin-payment").textContent = awaiting.length;
  document.getElementById("admin-winners").textContent = winners.filter(bet => bet.status === "won").length;
  const payoutDueRows = winners.filter(bet => bet.status === "won");
  document.getElementById("admin-total").textContent = payoutDueRows.some(bet => bet.payout === null)
    ? "Fee bands needed"
    : money(payoutDueRows.reduce((sum, bet) => sum + Number(bet.payout), 0));
  document.getElementById("admin-fees").textContent = money(winners.reduce((sum, bet) => sum + Number(bet.managerFee), 0));

  const winnerTable = document.getElementById("winners-table");
  winnerTable.innerHTML = winners.length
    ? winners.map(winnerRow).join("")
    : '<tr><td colspan="9"><div class="empty-state"><strong>No winners recorded yet</strong><p>Once a match result is confirmed, the winner, opponent, stake, 10% manager fee, and net payout will appear here.</p></div></td></tr>';

  const byId = new Map(adminBets.map(bet => [String(bet.id), bet]));
  const matchRows = adminBets.filter(bet => !bet.opponent || Number(bet.id) < Number(bet.opponent.id));
  const queue = document.getElementById("queue-table");
  queue.innerHTML = matchRows.length ? matchRows.map(bet => {
    const opponent = bet.opponent ? byId.get(String(bet.opponent.id)) : null;
    const type = bet.type === "konami" ? "eFootball" : "Football";
    const matchInfo = bet.type === "konami" ? "eFootball · one game" : `${bet.home || "Fixture"} vs ${bet.away || ""} · ${bet.pick}`;
    const efootballReady = bet.type !== "konami" || (bet.myReport && opponent?.myReport);
    const canResolve = bet.status === "paid" && opponent?.status === "paid" && efootballReady;
    const claimSummary = bet.type === "konami" ? claimsAgree(bet, opponent) : "";
    const participants = [bet, opponent].filter(Boolean);
    const pendingApprovals = participants.filter(player => player.userPaid && !player.paymentApproved);
    const paymentActions = pendingApprovals.map(player =>
      `<button class="table-action" data-approve-payment="${escapeHtml(player.id)}">Approve ${escapeHtml(player.player.name)}</button>`).join(" ");
    const resultAction = canResolve
      ? `<button class="table-action" data-resolve="${escapeHtml(bet.id)}">Resolve result</button>`
      : bet.status === "tie" || opponent?.status === "tie"
        ? `<button class="table-action" data-refund="${escapeHtml(bet.id)}">Mark refunds sent</button>`
        : "";
    const actions = [paymentActions, resultAction].filter(Boolean).join(" ");
    const matchStatus = !opponent ? statusLabel(bet.status)
      : bet.status === "refunded" || opponent.status === "refunded" ? "Refund marked sent"
      : bet.status === "tie" || opponent.status === "tie" ? "Tie · refund due"
      : bet.status === "completed" || opponent.status === "completed" ? "Payout sent"
      : bet.status === "won" || opponent.status === "won" ? "Winner recorded · payout due"
      : participants.some(player => !player.userPaid) ? "Waiting for both payment references"
      : participants.some(player => !player.paymentApproved) ? "Admin payment approval pending"
      : bet.type === "konami" && participants.some(player => !player.roomCode) ? "Waiting for both room codes"
      : bet.type === "konami" && (!bet.myReport || !opponent.myReport) ? "Waiting for both result reports"
      : "Ready for admin result review";
    const paymentDetails = participants.map(player => `
      <div class="person-cell payment-review-item">
        <strong>${escapeHtml(player.player.name)} · ${escapeHtml(player.paymentReference || "No reference")}</strong>
        <small>${player.paymentMethod === "send_money" ? `Send Money fee est. ${transferFeeLabel(player.stake)}` : player.paymentMethod === "till" ? "Till fee not provided" : "Method not selected"} · ${player.paymentApproved ? "Approved" : player.userPaid ? "Needs manual review" : "Payment not submitted"}</small>
      </div>`).join("");
    const roomCodes = bet.type === "konami" && opponent
      ? `<small>Codes: ${escapeHtml(bet.roomCode || "—")} / ${escapeHtml(opponent.roomCode || "—")}</small>` : "";
    return `<tr>
      <td><div class="person-cell"><strong>${escapeHtml(bet.player.name)}</strong><small>${escapeHtml(bet.player.account)}</small></div></td>
      <td>${type}</td>
      <td>${escapeHtml(matchInfo)}${bet.type === "konami" ? `<br><small class="bet-card-sub">${escapeHtml(claimSummary)}${bet.myScore ? ` · ${escapeHtml(bet.myScore)}` : ""}</small>` : ""}</td>
      <td><div class="person-cell"><strong>${escapeHtml(bet.opponent?.name || "Waiting for a mate")}</strong><small>${escapeHtml(bet.opponent?.account || "")}</small>${roomCodes}</div></td>
      <td>${money(bet.stake)}<br><small class="bet-card-sub">KES ${Number(bet.stake * participants.length).toLocaleString("en-KE")} total</small></td>
      <td><div class="payment-review-list">${paymentDetails}</div></td>
      <td><span class="status-badge">${escapeHtml(matchStatus)}</span></td>
      <td>${actions}</td>
    </tr>`;
  }).join("") : '<tr><td colspan="8"><div class="empty-state"><strong>No matches in the queue</strong><p>Requests and matched players will appear here.</p></div></td></tr>';
}

function openResolveModal(betId) {
  const bet = adminBets.find(item => String(item.id) === String(betId));
  const opponent = bet?.opponent ? adminBets.find(item => String(item.id) === String(bet.opponent.id)) : null;
  if (!bet || !opponent) return;
  openModal(`
    <button class="modal-close" aria-label="Close">×</button>
    <div class="eyebrow"><span class="eyebrow-line"></span> ADMIN · RESULT REVIEW</div>
    <h2>Resolve the match.</h2>
    <p class="modal-intro">${bet.type === "konami" ? "Both player reports are shown below. Matching reports are automatically recorded; this review is for conflicting reports. Room-code submission does not verify an eFootball result." : "Review the fixture result and select the player's correct prediction."}</p>
    ${bet.type === "konami" ? `<div class="modal-summary"><span>${escapeHtml(bet.player.name)}'s report</span><strong>${escapeHtml(resultLabel(bet.myReport))} ${bet.myScore ? `· ${escapeHtml(bet.myScore)}` : ""}</strong></div><div class="modal-summary"><span>${escapeHtml(opponent.player.name)}'s report</span><strong>${escapeHtml(resultLabel(opponent.myReport))} ${opponent.myScore ? `· ${escapeHtml(opponent.myScore)}` : ""}</strong></div>` : ""}
    <div class="modal-summary"><span>${escapeHtml(bet.player.name)}</span><strong>${money(bet.stake)}</strong></div>
    <div class="modal-summary"><span>${escapeHtml(opponent.player.name)}</span><strong>${money(opponent.stake)}</strong></div>
    <form class="modal-form" id="resolve-form">
      <label>Confirmed result<select class="form-control" name="winner" required>
        <option value="${escapeHtml(bet.id)}">${escapeHtml(bet.player.name)} won</option>
        <option value="${escapeHtml(opponent.id)}">${escapeHtml(opponent.player.name)} won</option>
        <option value="tie">Tie / refund both stakes</option>
      </select></label>
      <button class="primary-button" type="submit">Save result <span>→</span></button>
    </form>`);
  document.getElementById("resolve-form").addEventListener("submit", event => {
    event.preventDefault();
    const winnerBetId = new FormData(event.currentTarget).get("winner");
    runSafely(async () => {
      await api("admin.resolve", { betId: bet.id, winnerBetId });
      closeModal();
      await refreshAdmin();
      await refreshBets();
      showToast(winnerBetId === "tie" ? "Tie recorded. Refund both stakes, then mark them sent." : "Winner recorded. The net amount after the 10% manager fee is due manually.");
    });
  });
}

async function refreshAdminIfVisible() {
  if (document.getElementById("view-admin").classList.contains("active") && currentUser?.role === "admin") {
    await refreshAdmin();
  }
}

document.addEventListener("click", event => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    setActiveView(viewButton.dataset.view);
    return;
  }
  const fixtureButton = event.target.closest("[data-bet-fixture]");
  if (fixtureButton) {
    openFootballBet(fixtureButton.dataset.betFixture);
    return;
  }
  const filter = event.target.closest("[data-filter]");
  if (filter) {
    fixtureFilter = filter.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach(button => button.classList.toggle("active", button === filter));
    renderFixtures();
    return;
  }
  const scrollButton = event.target.closest("[data-scroll]");
  if (scrollButton) {
    document.getElementById(scrollButton.dataset.scroll).scrollIntoView({ behavior: "smooth" });
    return;
  }
  const betFilter = event.target.closest("[data-bet-filter]");
  if (betFilter) {
    activeBetFilter = betFilter.dataset.betFilter;
    document.querySelectorAll("[data-bet-filter]").forEach(button => button.classList.toggle("active", button === betFilter));
    renderMyBets();
    return;
  }
  const payButton = event.target.closest("[data-pay]");
  if (payButton) {
    openPaymentModal(payButton.dataset.pay);
    return;
  }
  const codeButton = event.target.closest("[data-code]");
  if (codeButton) {
    openCodeModal(codeButton.dataset.code);
    return;
  }
  const reportButton = event.target.closest("[data-report]");
  if (reportButton) {
    const bet = bets.find(item => String(item.id) === String(reportButton.dataset.report));
    if (bet) openResultReportModal(bet);
    return;
  }
  const cancelButton = event.target.closest("[data-cancel]");
  if (cancelButton) {
    runSafely(async () => {
      await api("bets.cancel", { betId: cancelButton.dataset.cancel });
      await refreshBets();
      await refreshAdminIfVisible();
      showToast("Open request cancelled. No payment was made.");
    });
    return;
  }
  const resultButton = event.target.closest("[data-resolve]");
  if (resultButton) {
    openResolveModal(resultButton.dataset.resolve);
    return;
  }
  const markSent = event.target.closest("[data-mark-sent]");
  if (markSent) {
    runSafely(async () => {
      await api("admin.markSent", { betId: markSent.dataset.markSent });
      await refreshAdmin();
      showToast("Payout marked as manually sent.");
    });
    return;
  }
  const approvePayment = event.target.closest("[data-approve-payment]");
  if (approvePayment) {
    runSafely(async () => {
      await api("admin.approvePayment", { betId: approvePayment.dataset.approvePayment });
      await refreshAdmin();
      showToast("Payment reference approved. The eFootball player can now submit a room code.");
    });
    return;
  }
  const refundButton = event.target.closest("[data-refund]");
  if (refundButton) {
    runSafely(async () => {
      await api("admin.markRefunded", { betId: refundButton.dataset.refund });
      await refreshAdmin();
      showToast("Refund marked as manually sent for both players.");
    });
    return;
  }
  const preset = event.target.closest("[data-stake]");
  if (preset) {
    const input = document.getElementById("konami-stake");
    input.value = preset.dataset.stake;
    input.dispatchEvent(new Event("input"));
  }
});

document.getElementById("konami-form").addEventListener("submit", event => {
  event.preventDefault();
  openKonamiChallenge();
});
document.getElementById("konami-stake").addEventListener("input", event => {
  document.getElementById("konami-payout").textContent = payoutText(payoutBreakdown(Number(event.target.value)).payout);
});
document.getElementById("top-account-button").addEventListener("click", () => {
  if (currentUser) setActiveView("my-bets");
  else openAccountModal("login");
});
document.getElementById("account-button").addEventListener("click", () => {
  if (!currentUser) {
    openAccountModal("register");
    return;
  }
  runSafely(async () => {
    await api("auth.logout");
    currentUser = null;
    bets = [];
    adminBets = [];
    renderAccount();
    await refreshBets();
    setActiveView("football");
    showToast("Signed out.");
  });
});
document.getElementById("banner-dismiss").addEventListener("click", () => document.querySelector(".demo-banner").remove());
document.getElementById("export-winners").addEventListener("click", () => {
  const winners = adminBets.filter(bet => ["won", "completed"].includes(bet.status));
  if (!winners.length) {
    showToast("There are no winner records to export yet.");
    return;
  }
  const rows = [["Winner", "Registration account", "M-Pesa name", "M-Pesa number", "Opponent", "Opponent account", "Type", "Stake KES", "Manager fee KES", "Amount to receive KES", "Send Money fee estimate KES", "Status"]];
  winners.forEach(bet => rows.push([
    bet.player.name, bet.player.account, bet.player.name, bet.player.phone,
    bet.opponent?.name || "", bet.opponent?.account || "", bet.type, bet.stake,
    bet.managerFee, bet.payout, bet.payoutSendMoneyFee ?? "Not in supplied bands", bet.status === "completed" ? "Sent" : "Payout due"
  ]));
  const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = "matchmate-winners.csv";
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Winner list exported.");
});

async function initialize() {
  try {
    const [session, fixtureData, feeData] = await Promise.all([api("auth.session"), api("fixtures.list"), api("fees.list")]);
    currentUser = session.user;
    fixtures = fixtureData.fixtures;
    sendMoneyBands = feeData.sendMoneyBands;
    managerFeePercent = Number(feeData.managerFeePercent);
    tariffNotice = feeData.tariffNotice;
    renderFixtures();
    renderAccount();
    await refreshBets();
    if (currentUser?.role === "admin") {
      document.querySelectorAll('[data-view="admin"], .admin-label').forEach(item => { item.hidden = false; });
    }
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(() => {
      if (!currentUser) return;
      refreshBets().catch(error => console.error("Bet refresh failed:", error));
      if (currentUser.role === "admin" && document.getElementById("view-admin").classList.contains("active")) {
        refreshAdmin().catch(error => console.error("Admin refresh failed:", error));
      }
    }, 10000);
  } catch (error) {
    showToast(error.message, true);
    renderFixtures();
    renderAccount();
    renderMyBets();
    renderAdmin();
  }
}

initialize();
