let adminBets = [];
let sendMoneyBands = [];
let managerFeePercent = 10;

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
  } catch {
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

function payoutText(value) {
  return value === null ? "Tariff unavailable" : money(value);
}

function transferFeeLabel(amount) {
  const band = sendMoneyBands.find(item => amount >= item.min && amount <= item.max);
  return band ? money(band.fee) : "Not in supplied tariff bands";
}

function shortDate(timestamp) {
  return new Intl.DateTimeFormat("en-KE", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

function statusLabel(status) {
  return ({
    open: "Looking for a mate",
    matched: "Matched · waiting for admin",
    awaiting_payment: "Payment requested · submit ref",
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

function whatsappLink(phone, message) {
  const digits = String(phone || "").replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function smsLink(phone, message) {
  return `sms:${encodeURIComponent(phone || "")}?body=${encodeURIComponent(message)}`;
}

function paymentRequestMessage(player, bet) {
  const deadline = bet.deadline ? shortDate(bet.deadline) : "the stated deadline";
  const match = bet.type === "konami" ? "eFootball" : `${bet.home} vs ${bet.away}`;
  return `MatchMate payment request for ${match}. Your stake: ${money(bet.stake)}. Matchmate: ${player.name} (${player.account}). Pay only from your registered M-Pesa number ${player.phone} and submit the reference by ${deadline}. Do not pay if the account or match details are incorrect.`;
}

function showToast(message, isError = false) {
  const region = document.getElementById("toast-region");
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " error" : ""}`;
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function runSafely(task) {
  return task().catch(error => showToast(error.message || "The request could not be completed.", true));
}

function renderWinnerRow(bet) {
  const winner = bet.player;
  const opponent = bet.opponent || { name: "Opponent", account: "—" };
  const message = `Hello ${winner.name}, your MatchMate ${bet.type === "konami" ? "eFootball" : "football"} win has been sent manually. Account: ${winner.account}. Bet: ${money(bet.stake)}. Manager fee: ${money(bet.managerFee)}. Amount sent: ${payoutText(bet.payout)}. Opponent: ${opponent.name}.`;
  const payoutActions = bet.status === "won" && bet.payout !== null
    ? `<a class="table-action" href="${escapeHtml(whatsappLink(winner.phone, message))}" target="_blank" rel="noopener">WhatsApp</a> <a class="table-action" href="${escapeHtml(smsLink(winner.phone, message))}">SMS</a> <button class="table-action" data-mark-sent="${escapeHtml(bet.id)}">Mark sent</button>`
    : "";
  return `<tr>
    <td><div class="person-cell"><strong>${escapeHtml(winner.name)}</strong><small>${escapeHtml(winner.account)}</small></div></td>
    <td><div class="person-cell"><strong>${escapeHtml(opponent.name)}</strong><small>${escapeHtml(opponent.account)}</small></div></td>
    <td>${money(bet.stake)}<br><small class="bet-card-sub">${escapeHtml(bet.type === "konami" ? "eFootball" : `${bet.home || ""} vs ${bet.away || ""}`)}</small></td>
    <td>${money(bet.managerFee)}<br><small class="bet-card-sub">${bet.managerFeePercent}% of pot</small></td>
    <td class="money-cell">${payoutText(bet.payout)}</td>
    <td>${bet.payoutSendMoneyFee === null ? "Not in bands" : money(bet.payoutSendMoneyFee)}<br><small class="bet-card-sub">deducted before payout</small></td>
    <td><div class="person-cell"><strong>${escapeHtml(winner.name)}</strong><small>${escapeHtml(winner.phone)}</small></div></td>
    <td><span class="status-badge status-${escapeHtml(bet.status)}">${bet.status === "completed" ? "Sent" : "Payout due"}</span></td>
    <td>${payoutActions}</td>
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
  const due = winners.filter(bet => bet.status === "won");
  const open = adminBets.filter(bet => bet.status === "open");
  const awaiting = adminBets.filter(bet => bet.userPaid && !bet.paymentApproved);
  document.getElementById("admin-open").textContent = open.length;
  document.getElementById("admin-payment").textContent = awaiting.length;
  document.getElementById("admin-winners").textContent = due.length;
  document.getElementById("admin-total").textContent = due.some(bet => bet.payout === null)
    ? "Fee bands needed" : money(due.reduce((sum, bet) => sum + Number(bet.payout), 0));
  document.getElementById("admin-fees").textContent = money(winners.reduce((sum, bet) => sum + Number(bet.managerFee), 0));
  document.getElementById("winners-table").innerHTML = winners.length
    ? winners.map(renderWinnerRow).join("")
    : '<tr><td colspan="9"><div class="empty-state"><strong>No winners recorded yet</strong><p>Confirmed winners, opponent details, and net payouts appear here.</p></div></td></tr>';
  document.getElementById("requests-table").innerHTML = open.length
    ? open.map(bet => {
      const selection = bet.type === "konami"
        ? escapeHtml(bet.teamName || "Team not provided")
        : `${escapeHtml(bet.home || "Fixture")} vs ${escapeHtml(bet.away || "")} · ${escapeHtml(bet.pick || "")}`;
      return `<tr><td><div class="person-cell"><strong>${escapeHtml(bet.player.name)}</strong><small>${escapeHtml(bet.player.account)}</small></div></td><td>${bet.type === "konami" ? "eFootball" : "Football"}</td><td>${selection}</td><td>${bet.type === "konami" ? escapeHtml(bet.teamStrength ?? "Not provided") : "—"}</td><td>${money(bet.stake)}</td><td>${escapeHtml(shortDate(bet.createdAt))}</td></tr>`;
    }).join("")
    : '<tr><td colspan="6"><div class="empty-state"><strong>No open betmate requests</strong><p>Unmatched football and eFootball requests will appear here.</p></div></td></tr>';

  const byId = new Map(adminBets.map(bet => [String(bet.id), bet]));
  const rows = adminBets.filter(bet => !bet.opponent || Number(bet.id) < Number(bet.opponent.id));
  document.getElementById("queue-table").innerHTML = rows.length
    ? rows.map(bet => renderQueueRow(bet, byId)).join("")
    : '<tr><td colspan="8"><div class="empty-state"><strong>No matches in the queue</strong><p>Requests and matched players appear here.</p></div></td></tr>';
}

function renderQueueRow(bet, byId) {
  const opponent = bet.opponent ? byId.get(String(bet.opponent.id)) : null;
  const participants = [bet, opponent].filter(Boolean);
  const isKonami = bet.type === "konami";
  const matchInfo = isKonami
    ? `eFootball · ${bet.teamName || "Team"} · strength ${bet.teamStrength ?? "—"}`
    : `${bet.home || "Fixture"} vs ${bet.away || ""} · ${bet.pick}`;
  const canResolve = bet.status === "paid" && opponent?.status === "paid" &&
    (!isKonami || (bet.myReport && opponent?.myReport));
  const expired = bet.status === "awaiting_payment" && bet.deadline && bet.deadline <= Date.now();
  const paymentActions = expired ? "" : participants
    .filter(player => player.userPaid && !player.paymentApproved)
    .map(player => `<button class="table-action" data-approve-payment="${escapeHtml(player.id)}">Approve ${escapeHtml(player.player.name)}</button>`)
    .join(" ");
  const requestAction = bet.status === "matched"
    ? `<button class="table-action" data-request-payment="${escapeHtml(bet.id)}">Request payment</button>` : "";
  const contactActions = bet.status === "awaiting_payment" && opponent && !expired
    ? participants.map(player => {
      const message = paymentRequestMessage(player.player, bet);
      return `<a class="table-action" href="${escapeHtml(whatsappLink(player.player.phone, message))}" target="_blank" rel="noopener">WhatsApp ${escapeHtml(player.player.name)}</a> <a class="table-action" href="${escapeHtml(smsLink(player.player.phone, message))}">SMS</a>`;
    }).join(" ")
    : "";
  const resultAction = canResolve
    ? `<button class="table-action" data-resolve="${escapeHtml(bet.id)}">Resolve result</button>`
    : bet.status === "tie" || opponent?.status === "tie"
      ? `<button class="table-action" data-refund="${escapeHtml(bet.id)}">Mark refunds sent</button>` : "";
  const status = !opponent ? statusLabel(bet.status)
    : bet.status === "matched" ? "Matched · admin payment request needed"
    : expired ? "Payment deadline passed · review required"
    : bet.status === "refunded" || opponent.status === "refunded" ? "Refund marked sent"
    : bet.status === "tie" || opponent.status === "tie" ? "Tie · refund due"
    : bet.status === "completed" || opponent.status === "completed" ? "Payout sent"
    : bet.status === "won" || opponent.status === "won" ? "Winner recorded · payout due"
    : participants.some(player => !player.userPaid) ? "Waiting for both payment references"
    : participants.some(player => !player.paymentApproved) ? "Admin payment approval pending"
    : isKonami && participants.some(player => !player.roomCode) ? "Waiting for both room codes"
    : isKonami && (!bet.myReport || !opponent.myReport) ? "Waiting for both result reports"
    : "Ready for admin result review";
  const payments = participants.map(player => `<div class="person-cell payment-review-item">
    <strong>${escapeHtml(player.player.name)} · ${escapeHtml(player.player.phone)}</strong>
    <small>${player.userPaid ? `Ref ${escapeHtml(player.paymentReference || "missing")} · Sender: ${escapeHtml(player.paymentSenderName || "name not provided")} · ${player.paidFromRegisteredNumber ? "Confirms registered number; verify sender" : "Registered number not confirmed"}` : "Payment not submitted"} · ${player.paymentMethod === "send_money" ? `Send Money fee est. ${transferFeeLabel(player.stake)}` : player.paymentMethod === "till" ? "Till fee not provided" : "Method not selected"} · ${player.paymentApproved ? "Approved" : player.userPaid ? "Needs manual review" : "Not reviewed"}</small>
  </div>`).join("");
  const roomCodes = isKonami && opponent
    ? `<small>Private codes (admin): ${escapeHtml(bet.roomCode || "not shared")} / ${escapeHtml(opponent.roomCode || "not shared")}</small>` : "";
  const actions = [requestAction, contactActions, paymentActions, resultAction].filter(Boolean).join(" ");
  return `<tr>
    <td><div class="person-cell"><strong>${escapeHtml(bet.player.name)}</strong><small>${escapeHtml(bet.player.account)}</small></div></td>
    <td>${isKonami ? "eFootball" : "Football"}</td>
    <td>${escapeHtml(matchInfo)}${isKonami ? `<br><small class="bet-card-sub">${escapeHtml(claimsAgree(bet, opponent))}${bet.myScore ? ` · ${escapeHtml(bet.myScore)}` : ""}</small>` : ""}</td>
    <td><div class="person-cell"><strong>${escapeHtml(bet.opponent?.name || "Waiting for a mate")}</strong><small>${escapeHtml(bet.opponent?.account || "")}</small>${roomCodes}</div></td>
    <td>${money(bet.stake)}<br><small class="bet-card-sub">KES ${Number(bet.stake * participants.length).toLocaleString("en-KE")} total</small></td>
    <td><div class="payment-review-list">${payments}</div></td>
    <td><span class="status-badge">${escapeHtml(status)}</span></td>
    <td>${actions}</td>
  </tr>`;
}

function openResolveModal(betId) {
  const bet = adminBets.find(item => String(item.id) === String(betId));
  const opponent = bet?.opponent ? adminBets.find(item => String(item.id) === String(bet.opponent.id)) : null;
  if (!bet || !opponent) return;
  const reportLabel = report => ({ win: "Player reports: win", loss: "Player reports: loss", tie: "Player reports: tie" })[report] || "Not reported";
  const modal = document.getElementById("modal-root");
  modal.innerHTML = `<div class="modal-backdrop" data-close-backdrop><section class="modal modal-wide" role="dialog" aria-modal="true">
    <button class="modal-close" aria-label="Close">×</button>
    <div class="eyebrow"><span class="eyebrow-line"></span> ADMIN · RESULT REVIEW</div>
    <h2>Resolve the match.</h2>
    <p class="modal-intro">${bet.type === "konami" ? "Review both player reports. Room-code submission does not verify an eFootball result." : "Review the fixture result and select the player's correct prediction."}</p>
    ${bet.type === "konami" ? `<div class="modal-summary"><span>${escapeHtml(bet.player.name)}'s report</span><strong>${escapeHtml(reportLabel(bet.myReport))} ${bet.myScore ? `· ${escapeHtml(bet.myScore)}` : ""}</strong></div><div class="modal-summary"><span>${escapeHtml(opponent.player.name)}'s report</span><strong>${escapeHtml(reportLabel(opponent.myReport))} ${opponent.myScore ? `· ${escapeHtml(opponent.myScore)}` : ""}</strong></div>` : ""}
    <div class="modal-summary"><span>${escapeHtml(bet.player.name)}</span><strong>${money(bet.stake)}</strong></div>
    <div class="modal-summary"><span>${escapeHtml(opponent.player.name)}</span><strong>${money(opponent.stake)}</strong></div>
    <form class="modal-form" id="resolve-form"><label>Confirmed result<select class="form-control" name="winner" required>
      <option value="${escapeHtml(bet.id)}">${escapeHtml(bet.player.name)} won</option>
      <option value="${escapeHtml(opponent.id)}">${escapeHtml(opponent.player.name)} won</option>
      <option value="tie">Tie / refund both stakes</option>
    </select></label><button class="primary-button" type="submit">Save result <span>→</span></button></form>
  </section></div>`;
  modal.querySelector(".modal-close").addEventListener("click", closeModal);
  modal.querySelector(".modal-backdrop").addEventListener("click", event => {
    if (event.target.hasAttribute("data-close-backdrop")) closeModal();
  });
  document.getElementById("resolve-form").addEventListener("submit", event => {
    event.preventDefault();
    const winnerBetId = new FormData(event.currentTarget).get("winner");
    runSafely(async () => {
      await api("admin.resolve", { betId: bet.id, winnerBetId });
      closeModal();
      await refreshAdmin();
      showToast(winnerBetId === "tie" ? "Tie recorded. Refund both stakes, then mark them sent." : "Winner recorded. The net amount after the 10% manager fee is due manually.");
    });
  });
}

function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

async function refreshAdmin() {
  const data = await api("admin.dashboard");
  adminBets = data.bets;
  renderAdmin();
}

document.addEventListener("click", event => {
  const target = event.target.closest("[data-resolve], [data-mark-sent], [data-approve-payment], [data-request-payment], [data-refund]");
  if (!target) return;
  if (target.dataset.resolve) {
    openResolveModal(target.dataset.resolve);
  } else if (target.dataset.markSent) {
    runSafely(async () => {
      await api("admin.markSent", { betId: target.dataset.markSent });
      await refreshAdmin();
      showToast("Payout marked as manually sent.");
    });
  } else if (target.dataset.approvePayment) {
    runSafely(async () => {
      await api("admin.approvePayment", { betId: target.dataset.approvePayment });
      await refreshAdmin();
      showToast("Payment reference approved. Room codes unlock only after both players are approved.");
    });
  } else if (target.dataset.requestPayment) {
    runSafely(async () => {
      await api("admin.requestPayment", { betId: target.dataset.requestPayment });
      await refreshAdmin();
      showToast("Payment requested. Players will see it in their dashboards.");
    });
  } else if (target.dataset.refund) {
    runSafely(async () => {
      await api("admin.markRefunded", { betId: target.dataset.refund });
      await refreshAdmin();
      showToast("Refund marked as manually sent for both players.");
    });
  }
});

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

document.getElementById("admin-sign-out").addEventListener("click", () => runSafely(async () => {
  await api("auth.logout");
  window.location.replace("index.html");
}));

async function initialize() {
  try {
    const [session, fees] = await Promise.all([api("auth.session"), api("fees.list")]);
    if (session.user?.role !== "admin") {
      window.location.replace("index.html?admin=denied");
      return;
    }
    sendMoneyBands = fees.sendMoneyBands;
    managerFeePercent = Number(fees.managerFeePercent);
    await refreshAdmin();
    window.setInterval(() => {
      refreshAdmin().catch(error => console.error("Admin refresh failed:", error));
    }, 5000);
  } catch (error) {
    showToast(error.message || "Could not load administrator data.", true);
  }
}

initialize();
