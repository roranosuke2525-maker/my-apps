  // ================= 🐔 にわとり牧場の帯：タスクの流れ（収集→次にやる→予定→今日→済み）をドット絵の牧場で見せる =================
  // 卵の巣＝収集、ひよこ＝次にやる、囲い＝予定、えさやり＝今日、卵かご＝済み。場所を押すとその段の一覧へ。
  // 済みにすると、えさやりの所から卵がかごへ転がる。絵は img/farm.jpg（build でこの画面に埋めこむ）
  const FARM = [["inbox", "収集", 8], ["next", "次にやる", 30], ["plan", "予定", 52], ["today", "今日", 71], ["done", "済み", 93]];
  function farmBandHtml(active) {
    const loading = S.mode === "loading" && !S.tasks.length;
    const late = lateOf().length;
    return `<div class="farm" role="group" aria-label="タスクの流れ（にわとり牧場）">${FARM.map(([k, name, x]) => {
      const n = inStage(k).length;
      return `<button type="button" class="fz${active === k ? " on" : ""}${k === "today" && late ? " late" : ""}" data-farm="${k}" style="left:${x}%" aria-label="${name} ${n}件"><b>${loading ? "…" : n}</b><small>${name}</small></button>`;
    }).join("")}</div>`;
  }
  function farmGo(k) {
    if (S.tab === "today" && k === "today") { $("#todaylist")?.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }); return; }
    S.tab = "flow"; S.stage = k; render();
  }
  // 済みにしたときのごほうび：卵が1つ、えさやりからかごへ
  function farmCelebrate() {
    if (reduce) return;
    setTimeout(() => {
      const f = $(".farm"); if (!f) return;
      const e = document.createElement("i"); e.className = "fegg"; e.setAttribute("aria-hidden", "true");
      f.appendChild(e); e.addEventListener("animationend", () => e.remove());
      const b = f.querySelector('[data-farm="done"]'); if (b) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
    }, 80);
  }
