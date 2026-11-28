/* ============================================================
   可选：填写表单收集地址，即可自动把答卷发到你的服务器/Webhook
   例如 n8n、飞书多维表格 Webhook、自建接口。
   留空时，问卷仍然可用，受访者通过“复制回答”回传。
   ============================================================ */
const CONFIG = {
  endpoint: "https://formsubmit.co/ajax/mxea4616@agent.qq.com",
  surveyId: "ai-creator-family-v3"
};

/* ── 状态 ── */
const DRAFT_KEY = "ai-creator-survey:v4:draft";
const DRAFT_LIFETIME = 30 * 60 * 1000;
let expiryTimer;
let submitting = false;
const state = {
  consent:false, age:"", ageRange:"", relation:"",
  p01:"",p02:"",p03:"",p04:"",p05:"",c01:"",c02:"",c03:""
};
const steps = ["s1","s2","s3","s4"];
let current = 0;
const labels = ["第一部分 / 共三部分","第二部分 / 共三部分","第三部分 / 共三部分","已提交"];

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ── 草稿保存 ── */
// These keys belonged to the previous release. Never restore old answers or consent.
function clearLegacyStorage(){
  for(const key of ["aics_survey_v3_draft", "aics_submitted"]){
    try{ localStorage.removeItem(key); }catch{}
  }
}

function forgetDraft(){
  clearTimeout(expiryTimer);
  try{ sessionStorage.removeItem(DRAFT_KEY); }catch{}
}

function saveDraft(){
  if(!state.consent || current >= 3) return forgetDraft();
  try{
    const expires = Date.now() + DRAFT_LIFETIME;
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({state, current, expires}));
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(forgetDraft, DRAFT_LIFETIME);
  }catch{ /* Private browsing may disable storage. The in-memory form still works. */ }
}

function validAge(age){
  return /^\d{1,2}$/.test(age) && Number(age) >= 3 && Number(age) <= 18;
}

function loadDraft(){
  try{
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if(!raw) return;
    const draft = JSON.parse(raw);
    const remaining = draft.expires - Date.now();
    if(!Number.isFinite(remaining) || remaining <= 0 || remaining > DRAFT_LIFETIME ||
        draft.state?.consent !== true) return forgetDraft();
    for(const key of Object.keys(state)){
      if(key !== "consent" && typeof draft.state[key] === "string") state[key] = draft.state[key];
    }
    state.consent = true;
    for(const key of ["ageRange", "relation"]){
      const choices = $$(`[data-group="${key}"] .chip`).map(c => c.dataset.val);
      if(!choices.includes(state[key])) state[key] = "";
    }
    const step = draft.current;
    if((step === 1 || step === 2) && firstStepComplete()){
      current = step === 2 && state.p05.trim() ? 2 : 1;
    }
  }catch{ forgetDraft(); }
}

function firstStepComplete(){
  return state.consent && (state.age ? validAge(state.age) : !!state.ageRange) &&
    ["p01","p02","p03","p04"].every(k => state[k].trim());
}

/* ── 渲染回填 ── */
function hydrate(){
  $("#consent").checked = !!state.consent;
  if(state.age) $("#age").value = state.age;
  $$(".chip").forEach(c => {
    const g = c.parentElement.dataset.group;
    if(!g) return;
    if(state[g] === c.dataset.val) c.setAttribute("aria-pressed","true");
  });
  $$("textarea").forEach(t => {
    const k = t.dataset.key;
    if(state[k]){ t.value = state[k]; autoGrow(t); }
  });
}

/* ── 自动增高 ── */
function autoGrow(el){
  el.style.height = "auto";
  el.style.height = Math.max(96, el.scrollHeight + 2) + "px";
}

/* ── 步骤切换 ── */
function goTo(i, scroll){
  current = Math.max(0, Math.min(steps.length - 1, i));
  steps.forEach((id, idx) => {
    document.getElementById(id).classList.toggle("active", idx === current);
  });
  $("#stepLabel").textContent = current === 3 ? $("#seal").textContent : labels[current];
  $$(".progress-seg").forEach((seg, idx) => seg.classList.toggle("on", idx <= Math.min(current,2)));

  $("#backBtn").style.display = current === 0 || current === 3 ? "none" : "block";
  $("#nextBtn").textContent = current === 2 ? "提交问卷" : "下一步";
  if(current === 3){
    $("#actionbar").style.display = "none";
  }else{
    $("#actionbar").style.display = "block";
    $("#counter").textContent = current === 2 ? "孩子部分全部选填" : "";
  }
  if(scroll !== false) window.scrollTo({top:0, behavior:"smooth"});
  saveDraft();
}

/* ── 校验 ── */
function showErr(id, scroll){
  const el = document.getElementById(id);
  if(!el) return;
  el.classList.add("show");
  if(scroll === false) return;
  const host = el.closest(".field, .consent, .q");
  if(host){
    host.classList.add("shake");
    setTimeout(()=>host.classList.remove("shake"), 450);
    host.scrollIntoView({behavior:"smooth", block:"center"});
  }
}
function hideErr(id){
  const el = document.getElementById(id);
  if(el) el.classList.remove("show");
}

function validateStep(){
  if(current === 0){
    let ok = true;
    if(!state.consent){ showErr("err-consent"); ok = false; }
    if(state.age ? !validAge(state.age) : !state.ageRange){
      showErr("err-age", ok ? true : false);
      ok = false;
    }
    // 家长题必填
    const qs = $$("#s1 .q");
    qs.forEach(q => {
      const ta = q.querySelector("textarea");
      if(!ta.value.trim()){
        q.querySelector(".err").classList.add("show");
        if(ok){
          q.classList.add("shake");
          setTimeout(()=>q.classList.remove("shake"),450);
          q.scrollIntoView({behavior:"smooth",block:"center"});
        }
        ok = false;
      }
    });
    return ok;
  }
  if(current === 1){
    const ta = document.querySelector('#s2 textarea[data-key="p05"]');
    if(!ta.value.trim()){
      const q = ta.closest(".q");
      q.querySelector(".err").classList.add("show");
      q.classList.add("shake");
      setTimeout(()=>q.classList.remove("shake"),450);
      q.scrollIntoView({behavior:"smooth",block:"center"});
      return false;
    }
  }
  return true;
}

/* ── 家庭编号 ── */
function makeId(){
  const d = new Date();
  const y = String(d.getFullYear()).slice(2);
  const m = String(d.getMonth()+1).padStart(2,"0");
  const chars = "ACDEFGHJKLMNPQRTUVWXY3479";
  let code = "";
  for(let i=0;i<4;i++) code += chars[Math.floor(Math.random()*chars.length)];
  return `AIC-${y}${m}-${code}`;
}

/* ── 生成文本记录 ── */
function buildTranscript(id){
  const L = [];
  const ageText = state.age ? `${state.age} 岁` : (state.ageRange || "未填");
  L.push("【AI 小小创造者 · 家庭调研】");
  L.push(`家庭编号：${id}`);
  L.push(`提交时间：${new Date().toLocaleString("zh-CN",{hour12:false})}`);
  L.push("");
  L.push("── 基本信息 ──");
  L.push(`孩子年龄：${ageText}`);
  L.push(`与孩子关系：${state.relation || "未填"}`);
  L.push("");
  L.push("── 第一部分：兴趣、探索与创造力 ──");
  L.push(`P01｜最近主动想研究或做出来的事：\n${state.p01.trim()}`);
  L.push("");
  L.push(`P02｜有成就感或让别人受益的事：\n${state.p02.trim()}`);
  L.push("");
  L.push(`P03｜AI 接触情况与期待、顾虑：\n${state.p03.trim()}`);
  L.push("");
  L.push(`P04｜过去一年值得的课程或活动：\n${state.p04.trim()}`);
  L.push("");
  L.push("── 第二部分：课程反馈 ──");
  L.push(`P05｜课程价值判断与报名条件：\n${state.p05.trim()}`);
  L.push("");
  L.push("── 第三部分：孩子轻交流 ──");
  L.push(`C01｜最近喜欢做、玩或研究的：\n${state.c01.trim() || "（未填）"}`);
  L.push("");
  L.push(`C02｜特别想做但现在做不到的：\n${state.c02.trim() || "（未填）"}`);
  L.push("");
  L.push(`C03｜最希望谁看到、用到，以及原因：\n${state.c03.trim() || "（未填）"}`);
  return L.join("\n");
}

/* ── 提交 ── */
async function submit(){
  if(submitting || current !== 2) return;
  if(!firstStepComplete()){ goTo(0); validateStep(); return; }
  if(!state.p05.trim()){ goTo(1); validateStep(); return; }
  submitting = true;
  $("#backBtn").disabled = true;
  const id = makeId();
  const text = buildTranscript(id);
  const payload = {
    _subject: `AI 小小创造者调研 · ${id}`,
    survey: CONFIG.surveyId,
    id,
    submittedAt: new Date().toISOString(),
    age: state.age || null,
    ageRange: state.ageRange || null,
    relation: state.relation || null,
    p01: state.p01.trim(), p02: state.p02.trim(), p03: state.p03.trim(),
    p04: state.p04.trim(), p05: state.p05.trim(),
    c01: state.c01.trim(), c02: state.c02.trim(), c03: state.c03.trim()
  };

  const btn = $("#nextBtn");
  btn.disabled = true;
  btn.textContent = "提交中…";

  let delivered = false;
  if(CONFIG.endpoint && !$('[name="_honey"]').value){
    delivered = await deliver(payload, text);
  }

  $("#famidOut").textContent = id;
  $("#transcript").textContent = text;
  forgetDraft();

  renderDone(delivered);
  goTo(3);
}

/* ── 上报 ──
   飞书群机器人：包一层 text 消息（该端点支持跨域，可直接读响应）
   其它（FormSubmit / Formspree / n8n / 自建）：直接发 JSON
*/
const isFeishuBot = () => /open-apis\/bot\/v2\/hook/.test(CONFIG.endpoint);
const isFormSubmit = () => /formsubmit\.co/.test(CONFIG.endpoint);

async function deliver(payload, text){
  let body;
  if(isFeishuBot()){
    body = JSON.stringify({ msg_type:"text", content:{ text } });
  }else if(isFormSubmit()){
    // 使用服务商默认的过滤设置。
    body = JSON.stringify({ ...payload, _template:"table" });
  }else{
    body = JSON.stringify(payload);
  }

  let timer;
  try{
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(CONFIG.endpoint, {
      method:"POST", credentials:"omit", redirect:"error", cache:"no-store",
      signal:controller.signal,
      headers:{"Content-Type":"application/json; charset=utf-8","Accept":"application/json"},
      body
    });
    if(!res.ok) return false;
    if(isFormSubmit()){
      const receipt = await res.json();
      return receipt?.success === true || receipt?.success === "true";
    }
    if(isFeishuBot()) return (await res.json())?.code === 0;
    // Generic webhooks can legitimately acknowledge with an empty or non-JSON 2xx.
    const receipt = await res.json().catch(() => null);
    return receipt?.ok !== false && receipt?.success !== false && receipt?.success !== "false" &&
      (typeof receipt?.code !== "number" || receipt.code === 0);
  }catch{
    return false;
  }finally{
    clearTimeout(timer);
  }
}

/* ── 完成页三种状态 ── */
function renderDone(delivered){
  const note = $("#doneNote"), fine = $("#doneFine"), seal = $("#seal");

  if(!CONFIG.endpoint){
    seal.textContent = "已提交";
    seal.classList.remove("fail");
    note.innerHTML = '你的回答已经整理成一份记录。<strong>请点击下面的按钮复制它，并发送给邀请你参与调研的研究员。</strong>也可以直接把这一页截图发过去。';
    fine.textContent = "这份记录只保存在你自己的设备上。如果你改变了主意，随时可以关闭页面，不必发送。";
    $("#copyBlock").style.display = "block";
    $("#dlOnly").style.display = "none";
    return;
  }

  if(delivered){
    seal.textContent = "已提交";
    seal.classList.remove("fail");
    note.innerHTML = '你的回答已经发送到教研团队，我们会认真读。谢谢你的时间。';
    fine.textContent = "如果需要留一份自己的记录，可以下载下面的文本文件。";
    $("#copyBlock").style.display = "none";
    $("#dlOnly").style.display = "flex";
    return;
  }

  seal.textContent = "未发送";
  seal.classList.add("fail");
  note.innerHTML = '自动发送没有成功，可能是网络的问题。<strong>请在关闭页面前复制回答或下载文本文件，以免丢失。</strong>';
  fine.textContent = "你可以把复制的回答或下载的文件发给邀请你参与调研的人。";
  $("#copyBlock").style.display = "block";
  $("#dlOnly").style.display = "none";
}

/* ── 事件绑定 ── */
document.addEventListener("DOMContentLoaded", () => {
  clearLegacyStorage();
  loadDraft();
  hydrate();
  goTo(current, false);

  // 同意
  $("#consent").addEventListener("change", e => {
    state.consent = e.target.checked;
    if(state.consent) hideErr("err-consent");
    saveDraft();
  });

  // 年龄
  $("#age").addEventListener("input", e => {
    state.age = e.target.value;
    if(state.age) { state.ageRange = "";
      $$('[data-group="ageRange"] .chip').forEach(c=>c.setAttribute("aria-pressed","false"));
      hideErr("err-age");
    }
    saveDraft();
  });

  // 选项组
  $$('[data-group]').forEach(group => {
    const key = group.dataset.group;
    group.querySelectorAll(".chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const val = chip.dataset.val;
        const isOn = chip.getAttribute("aria-pressed") === "true";
        group.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed","false"));
        if(isOn){
          state[key] = "";
        }else{
          chip.setAttribute("aria-pressed","true");
          state[key] = val;
          if(key === "ageRange"){ state.age = ""; $("#age").value = ""; hideErr("err-age"); }
        }
        saveDraft();
      });
    });
  });

  // 文本域
  $$("textarea").forEach(ta => {
    const key = ta.dataset.key;
    autoGrow(ta);
    ta.addEventListener("input", () => {
      state[key] = ta.value;
      autoGrow(ta);
      if(ta.value.trim()){
        const q = ta.closest(".q");
        q?.querySelector(".err")?.classList.remove("show");
      }
      saveDraft();
    });
  });

  // 快捷填入
  $$(".quick button").forEach(btn => {
    btn.addEventListener("click", () => {
      const ta = btn.closest(".q").querySelector("textarea");
      ta.value = btn.dataset.fill;
      ta.dispatchEvent(new Event("input"));
      ta.focus();
    });
  });

  // 导航
  $("#nextBtn").addEventListener("click", () => {
    if(!validateStep()) return;
    if(current === 2){ submit(); return; }
    goTo(current + 1);
  });
  $("#backBtn").addEventListener("click", () => goTo(current - 1));

  // 复制
  $("#copyBtn").addEventListener("click", async () => {
    const text = $("#transcript").textContent;
    try{
      await navigator.clipboard.writeText(text);
      toast("已复制，请粘贴到微信发给研究员");
    }catch(e){
      const r = document.createRange();
      r.selectNodeContents($("#transcript"));
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(r);
      toast("已选中文字，长按复制即可");
    }
  });

  // 下载
  const download = () => {
    const text = $("#transcript").textContent;
    const blob = new Blob([text], {type:"text/plain;charset=utf-8"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `AI小小创造者调研_${$("#famidOut").textContent}.txt`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
  };
  $("#dlBtn").addEventListener("click", download);
  $("#dlBtn2").addEventListener("click", download);
});

let toastTimer;
function toast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove("show"), 2600);
}

window.addEventListener("pageshow", event => {
  if(event.persisted) window.location.reload();
});
