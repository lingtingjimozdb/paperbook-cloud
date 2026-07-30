
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://ylxgsvoenrtoxehuzzgr.supabase.co";
const SUPABASE_KEY = "sb_publishable_LIrPU5KZKzZxNlPgIwupuA__nty8De7";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
let mode = "login";
let session = null;
let workspaceId = null;
let notebooks = [];
let pages = [];
let activeNotebookId = null;
let activePageId = null;
let saveTimer = null;
let promptResolver = null;
let scanObjectUrl = null;
let scanFiles = [];
let activeScanIndex = 0;
let scanFilter = "enhance";
let scanRotation = 0;
let scanKind = "document";
let dictationRecognition = null;
let meetingRecognition = null;
let dictationBaseText = "";
let meetingBaseText = "";
let meetingStartedAt = null;
let meetingTimerId = null;
let speechUtterance = null;
let speechVoices = [];
let latestMeetingSummary = "";
let schedules = JSON.parse(localStorage.getItem("paperbook_schedules") || "[]");
let showCompletedSchedules = false;

function toast(message, timeout=2600) {
  $("toast").textContent = message;
  $("toast").classList.remove("hidden");
  setTimeout(() => $("toast").classList.add("hidden"), timeout);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function sanitizeHtml(value) {
  const template = document.createElement("template");
  template.innerHTML = String(value || "");
  template.content.querySelectorAll("script,style,iframe,object,embed,link,meta").forEach(node => node.remove());
  template.content.querySelectorAll("*").forEach(node => {
    [...node.attributes].forEach(attribute => {
      const name = attribute.name.toLowerCase();
      const content = attribute.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        name === "srcdoc" ||
        ((name === "href" || name === "src") && /^(javascript|vbscript|data:text\/html):/.test(content))
      ) {
        node.removeAttribute(attribute.name);
      }
    });
  });
  return template.innerHTML;
}


function normalizeAccount(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

function encodeAccount(value) {
  const bytes = new TextEncoder().encode(normalizeAccount(value));
  let binary = "";
  bytes.forEach(byte => binary += String.fromCharCode(byte));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeAccount(value) {
  try {
    let encoded = value.replace(/^u\./, "").replace(/-/g, "+").replace(/_/g, "/");
    while (encoded.length % 4) encoded += "=";
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return value;
  }
}

function accountToInternalEmail(account) {
  const normalized = normalizeAccount(account);
  if (normalized.includes("@")) return normalized;
  return `u.${encodeAccount(normalized)}@paperbook.example`;
}

function displayAccount(email) {
  const value = String(email || "");
  if (value.startsWith("u.") && value.endsWith("@paperbook.example")) {
    return decodeAccount(value.slice(0, -"@paperbook.example".length));
  }
  return value;
}

function validateAccount(account) {
  const normalized = normalizeAccount(account);
  if (normalized.length < 2) return "账号名至少 2 个字符。";
  if (normalized.length > 32) return "账号名最多 32 个字符。";
  if (/[\r\n\t]/.test(normalized)) return "账号名包含无效字符。";
  return "";
}

function setSync(text) { $("syncStatus").textContent = text; }
function setSave(text) { $("saveState").textContent = text; }

function showAuth() {
  document.body.classList.remove("app-ready");
  closeMore();
  closeVoiceStudio();
  stopSpeech();
  $("authScreen").classList.remove("hidden");
  $("app").classList.add("hidden");
}

function showApp() {
  document.body.classList.add("app-ready");
  $("authScreen").classList.add("hidden");
  $("app").classList.remove("hidden");
  const metadataName = session?.user?.user_metadata?.display_name;
  $("userEmail").textContent = metadataName || displayAccount(session?.user?.email ?? "");
}

function setMode(next) {
  mode = next;
  $("loginTab").classList.toggle("active", next === "login");
  $("signupTab").classList.toggle("active", next === "signup");
  $("authSubmit").textContent = next === "login" ? "登录" : "注册";
  $("passwordInput").autocomplete = next === "login" ? "current-password" : "new-password";
  $("emailInput").placeholder = next === "login" ? "输入账号名" : "设置一个账号名";
}

async function authSubmit(event) {
  event.preventDefault();

  const account = $("emailInput").value;
  const accountError = validateAccount(account);
  if (accountError) return toast(accountError, 4200);

  const normalizedAccount = normalizeAccount(account);
  const email = accountToInternalEmail(normalizedAccount);
  const password = $("passwordInput").value;

  $("authSubmit").disabled = true;
  try {
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: normalizedAccount }
        }
      });
      if (error) throw error;

      if (data.session) {
        toast("注册成功，已自动登录。");
      } else {
        toast("账号已创建，但项目仍要求邮箱确认。请关闭 Supabase 的 Confirm Email。", 7000);
      }
    }
  } catch (error) {
    const message = String(error?.message || "");
    if (/invalid login credentials/i.test(message)) {
      toast("账号或密码不正确。", 4500);
    } else if (/user already registered/i.test(message)) {
      toast("这个账号已经存在，请直接登录。", 4500);
    } else {
      toast(message || "操作失败", 5000);
    }
  } finally {
    $("authSubmit").disabled = false;
  }
}

async function forgotPassword() {
  toast("账号名登录不依赖邮箱。请妥善保存密码；测试版忘记密码时需由管理员处理。", 6500);
}

async function bootstrap() {
  setSync("正在连接云端…");

  // Prefer reading the membership directly. This keeps the app usable even
  // when Supabase has not refreshed its RPC schema cache yet.
  let { data: membership, error: memberError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", session.user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (memberError) throw memberError;

  // Only use the repair RPC when no membership exists.
  if (!membership?.workspace_id) {
    const { data: repairedId, error: repairError } = await supabase
      .rpc("ensure_private_workspace");

    if (!repairError && repairedId) {
      membership = { workspace_id: repairedId };
    } else {
      // Re-check once because the SQL backfill may have completed while
      // this page was loading.
      const retry = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", session.user.id)
        .order("created_at")
        .limit(1)
        .maybeSingle();

      if (retry.error) throw retry.error;
      membership = retry.data;

      if (!membership?.workspace_id) {
        const details = repairError?.message ? `：${repairError.message}` : "";
        throw new Error(`账户空间尚未建立${details}`);
      }
    }
  }

  workspaceId = membership.workspace_id;
  await loadNotebooks();
  setSync("已连接云端");
}

async function loadNotebooks(selectId=null) {
  const { data, error } = await supabase
    .from("notebooks")
    .select("id,name,sort_order,created_at")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .eq("is_archived", false)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  notebooks = data || [];

  if (!notebooks.length) {
    const { data: created, error: createError } = await supabase
      .from("notebooks")
      .insert({workspace_id: workspaceId, created_by: session.user.id, name: "我的笔记本"})
      .select()
      .single();
    if (createError) throw createError;
    notebooks = [created];
  }

  activeNotebookId = selectId && notebooks.some(n=>n.id===selectId)
    ? selectId
    : activeNotebookId && notebooks.some(n=>n.id===activeNotebookId)
      ? activeNotebookId
      : notebooks[0].id;

  renderNotebooks();
  await loadPages();
}

function renderNotebooks() {
  const el = $("notebookList");
  el.innerHTML = "";
  notebooks.forEach(n => {
    const count = n.id === activeNotebookId ? pages.length : "";
    const div = document.createElement("div");
    div.className = "item " + (n.id === activeNotebookId ? "active" : "");
    div.innerHTML = `<span>📘</span><span class="grow">${esc(n.name)}</span><span class="badge">${count}</span>`;
    div.onclick = async () => {
      await saveCurrent();
      activeNotebookId = n.id;
      renderNotebooks();
      await loadPages();
    };
    el.appendChild(div);
  });
}

async function loadPages(selectId=null) {
  const { data, error } = await supabase
    .from("pages")
    .select("id,title,content_json,plain_text,sort_order,is_pinned,revision,updated_at")
    .eq("workspace_id", workspaceId)
    .eq("notebook_id", activeNotebookId)
    .is("deleted_at", null)
    .eq("is_archived", false)
    .order("is_pinned", { ascending:false })
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  pages = data || [];

  if (!pages.length) {
    const { data: created, error: createError } = await supabase
      .from("pages")
      .insert({
        workspace_id:workspaceId, notebook_id:activeNotebookId,
        created_by:session.user.id, updated_by:session.user.id,
        title:"第一页", content_json:{html:""}, plain_text:"", sort_order:0
      })
      .select()
      .single();
    if (createError) throw createError;
    pages = [created];
  }

  activePageId = selectId && pages.some(p=>p.id===selectId)
    ? selectId
    : activePageId && pages.some(p=>p.id===activePageId)
      ? activePageId
      : pages[0].id;

  renderPages();
  openPage(activePageId, false);
  renderNotebooks();
}

function filteredPages() {
  const q = $("searchInput").value.trim().toLowerCase();
  if (!q) return pages;
  return pages.filter(p => (
    (p.title || "") + " " + (p.plain_text || "")
  ).toLowerCase().includes(q));
}

function renderPages() {
  const el = $("pageList");
  el.innerHTML = "";
  filteredPages().forEach(p => {
    const index = pages.findIndex(x=>x.id===p.id);
    const div = document.createElement("div");
    div.className = "item " + (p.id === activePageId ? "active" : "");
    div.innerHTML = `<span>${p.is_pinned ? "📌":"📄"}</span><span class="grow">${esc(p.title)}</span><span class="badge">${index+1}</span>`;
    div.onclick = async () => {
      await saveCurrent();
      openPage(p.id);
    };
    el.appendChild(div);
  });
}

function currentPage() { return pages.find(p=>p.id===activePageId); }

function openPage(id) {
  activePageId = id;
  const p = currentPage();
  if (!p) return;
  $("titleInput").value = p.title || "";
  $("tagsInput").value = (p.content_json?.tags || []).join(", ");
  $("editor").innerHTML = sanitizeHtml(p.content_json?.html || "");
  updateWordCount();
  renderPages();
  renderPageNumbers();
  setSave("已保存");
}

function renderPageNumbers() {
  const index = Math.max(0, pages.findIndex(p=>p.id===activePageId));
  $("pageCounter").textContent = `第 ${index+1} 页 / 共 ${pages.length} 页`;
  const el = $("pageNumbers");
  el.innerHTML = "";
  let start = Math.max(0,index-4), end = Math.min(pages.length,start+9);
  start = Math.max(0,end-9);
  for(let i=start;i<end;i++) {
    const b=document.createElement("button");
    b.textContent=i+1;
    if(i===index)b.className="active";
    b.onclick=async()=>{await saveCurrent();openPage(pages[i].id)};
    el.appendChild(b);
  }
}

function captureEditor() {
  const html = sanitizeHtml($("editor").innerHTML);
  const temp = document.createElement("div");
  temp.innerHTML = html;
  return {
    title: $("titleInput").value.trim() || "无标题页",
    html,
    plainText: temp.textContent || "",
    tags: $("tagsInput").value.split(/[,，]/).map(x=>x.trim()).filter(Boolean)
  };
}

function updateWordCount() {
  const count = ($("editor").textContent || "").replace(/\s/g, "").length;
  $("wordCount").textContent = `${count} 字`;
}

function scheduleSave() {
  updateWordCount();
  setSave("正在保存…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrent, 700);
}

async function saveCurrent() {
  clearTimeout(saveTimer);
  const p = currentPage();
  if (!p || !session) return;
  const edited = captureEditor();
  const oldRevision = p.revision || 1;
  setSync(navigator.onLine ? "正在同步…" : "离线，等待同步");

  const { data, error } = await supabase
    .from("pages")
    .update({
      title:edited.title,
      content_json:{html:edited.html,tags:edited.tags},
      plain_text:edited.plainText,
      updated_by:session.user.id,
      revision:oldRevision+1
    })
    .eq("id",p.id)
    .eq("revision",oldRevision)
    .select()
    .maybeSingle();

  if (error) {
    setSave("保存失败");
    setSync("同步失败");
    toast(error.message, 5000);
    return;
  }

  if (!data) {
    setSave("发现冲突");
    setSync("存在其他设备修改");
    toast("该页面已在其他设备修改。正在刷新云端版本。", 5000);
    await loadPages(p.id);
    return;
  }

  Object.assign(p,data);
  setSave("已保存");
  setSync("已连接云端");
  renderPages();
}

async function newNotebook() {
  const name = await promptValue("新建笔记本", "新笔记本");
  if (!name) return;
  const { data,error }=await supabase.from("notebooks").insert({
    workspace_id:workspaceId,created_by:session.user.id,name
  }).select().single();
  if(error)return toast(error.message,4500);
  await loadNotebooks(data.id);
}

async function renameNotebook() {
  const current=notebooks.find(n=>n.id===activeNotebookId);
  if(!current)return;
  const name=await promptValue("重命名笔记本",current.name);
  if(!name)return;
  const {error}=await supabase.from("notebooks").update({name}).eq("id",current.id);
  if(error)return toast(error.message,4500);
  await loadNotebooks(current.id);
}

async function newPage() {
  await saveCurrent();
  const nextOrder=pages.length;
  const {data,error}=await supabase.from("pages").insert({
    workspace_id:workspaceId,notebook_id:activeNotebookId,
    created_by:session.user.id,updated_by:session.user.id,
    title:"新页面",content_json:{html:"",tags:[]},plain_text:"",sort_order:nextOrder
  }).select().single();
  if(error)return toast(error.message,4500);
  await loadPages(data.id);
}

async function deletePage() {
  if(pages.length<=1)return toast("每本笔记至少保留一页。");
  const p=currentPage();
  if(!p||!confirm(`确定删除“${p.title}”吗？`))return;
  const {error}=await supabase.from("pages").update({deleted_at:new Date().toISOString()}).eq("id",p.id);
  if(error)return toast(error.message,4500);
  activePageId=null;
  await loadPages();
}

async function step(delta) {
  await saveCurrent();
  const index=pages.findIndex(p=>p.id===activePageId);
  const next=index+delta;
  if(next>=0&&next<pages.length)openPage(pages[next].id);
}

async function jumpPage() {
  const n=parseInt($("jumpInput").value,10);
  if(n>=1&&n<=pages.length){await saveCurrent();openPage(pages[n-1].id)}
}

async function exportBackup() {
  await saveCurrent();
  const {data:allPages,error}=await supabase.from("pages")
    .select("*").eq("workspace_id",workspaceId).is("deleted_at",null);
  if(error)return toast(error.message,4500);
  const payload={version:"cloud-v1",exportedAt:new Date().toISOString(),notebooks,pages:allPages};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="PaperBook_Cloud_备份_"+new Date().toISOString().slice(0,10)+".json";
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),500);
}

async function importBackup(file) {
  let payload;
  try{payload=JSON.parse(await file.text())}catch{return toast("备份文件格式错误。")}
  if(!Array.isArray(payload.notebooks)||!Array.isArray(payload.pages))return toast("不是有效的 PaperBook 备份。");
  const idMap=new Map();
  for(const oldBook of payload.notebooks){
    const {data,error}=await supabase.from("notebooks").insert({
      workspace_id:workspaceId,created_by:session.user.id,name:oldBook.name+"（导入）"
    }).select().single();
    if(error)return toast(error.message,4500);
    idMap.set(oldBook.id,data.id);
  }
  for(const oldPage of payload.pages){
    const notebookId=idMap.get(oldPage.notebook_id);
    if(!notebookId)continue;
    const {error}=await supabase.from("pages").insert({
      workspace_id:workspaceId,notebook_id:notebookId,
      created_by:session.user.id,updated_by:session.user.id,
      title:oldPage.title||"无标题页",
      content_json:{
        ...(oldPage.content_json || {}),
        html:sanitizeHtml(oldPage.content_json?.html || "")
      },
      plain_text:String(oldPage.plain_text || ""),
      sort_order:oldPage.sort_order||0
    });
    if(error)return toast(error.message,4500);
  }
  toast("导入完成。");
  await loadNotebooks();
}

function promptValue(title,value="") {
  return new Promise(resolve=>{
    promptResolver=resolve;
    $("promptTitle").textContent=title;
    $("promptInput").value=value;
    $("promptDialog").showModal();
    setTimeout(()=>$("promptInput").focus(),0);
  });
}

function resolvePrompt(value) {
  if(promptResolver)promptResolver(value);
  promptResolver=null;
}

function applyTheme() {
  document.body.classList.toggle("dark",localStorage.getItem("paperbook_theme")==="dark");
}

function setMobileTab(tab) {
  if (tab === "more") return openMore();
  document.body.dataset.mobileTab = tab;
  $("mobileNav").querySelectorAll("[data-mobile-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.mobileTab === tab);
  });
}
window.__paperbookSetMobileTab = setMobileTab;

function openMore() {
  $("moreBackdrop").classList.remove("hidden");
  $("moreSheet").classList.remove("hidden");
}

function closeMore() {
  $("moreBackdrop").classList.add("hidden");
  $("moreSheet").classList.add("hidden");
}

function openScanner() {
  closeMore();
  const mobile = matchMedia("(max-width: 800px)").matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
  $("scannerDeviceHint").textContent = mobile ? "拍照扫描，连续识别并整理为文档" : "批量导入图片，准确识别并整理为文档";
  $("cameraScanBtn").classList.toggle("hidden", !mobile);
  $("scanActionTitle").textContent = mobile ? "拍照或导入文档" : "导入文档图片";
  $("scanDialog").showModal();
}

function chooseScanImage(useCamera) {
  if (useCamera && window.AndroidBridge && typeof window.AndroidBridge.openScanner === "function") {
    window.AndroidBridge.openScanner();
    return;
  }
  if (useCamera) $("scanPicker").setAttribute("capture", "environment");
  else $("scanPicker").removeAttribute("capture");
  $("scanPicker").toggleAttribute("multiple", !useCamera);
  $("scanPicker").click();
}

function addScanFiles(files) {
  const images = [...files].filter(file => file.type.startsWith("image/"));
  if (!images.length) return toast("请选择图片文件。");
  scanFiles.push(...images.map(file => ({file, url:URL.createObjectURL(file), rotation:0, text:""})));
  activeScanIndex = Math.max(0, scanFiles.length - images.length);
  $("scanEmpty").classList.add("hidden");
  $("scanWorkspace").classList.remove("hidden");
  renderScanPages();
  renderScanCanvas();
}

function renderScanPages() {
  $("scanPageCount").textContent = `${scanFiles.length} 页`;
  $("scanPageList").innerHTML = scanFiles.map((item,index)=>`
    <div class="scan-page ${index===activeScanIndex?"active":""}" data-scan-page="${index}">
      <img src="${item.url}" alt="第 ${index+1} 页" /><span>第 ${index+1} 页</span>
      <button type="button" data-remove-scan="${index}" aria-label="删除第 ${index+1} 页">×</button>
    </div>`).join("");
}

async function renderScanCanvas() {
  const item = scanFiles[activeScanIndex];
  if (!item) return;
  const image = new Image();
  image.onload = () => {
    const canvas = $("scanCanvas");
    const angle = item.rotation || 0;
    const sideways = angle % 180 !== 0;
    const maxSide = 1800;
    const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.round(image.naturalWidth * ratio);
    const height = Math.round(image.naturalHeight * ratio);
    canvas.width = sideways ? height : width;
    canvas.height = sideways ? width : height;
    const context = canvas.getContext("2d", {willReadFrequently:true});
    context.save();
    context.translate(canvas.width/2,canvas.height/2);
    context.rotate(angle*Math.PI/180);
    context.filter = scanFilter==="gray" ? "grayscale(1) contrast(1.15)" :
      scanFilter==="bw" ? "grayscale(1) contrast(2.1)" :
      scanFilter==="enhance" ? "contrast(1.16) saturate(.92) brightness(1.06)" : "none";
    context.drawImage(image,-width/2,-height/2,width,height);
    context.restore();
  };
  image.src = item.url;
  $("ocrResult").value = item.text || "";
}

function canvasDataUrl(quality=.9) {
  return $("scanCanvas").toDataURL("image/jpeg", quality);
}

async function runLocalOcr() {
  if (window.AndroidBridge && typeof window.AndroidBridge.openScanner === "function") {
    window.AndroidBridge.openScanner();
    return;
  }
  setOcrStatus("设备识别需手机 App", "warn");
  toast("电脑端请使用 AI 精准识别；手机 App 支持离线快速识别。", 3800);
}

function setOcrStatus(text, className="") {
  $("ocrStatus").textContent = text;
  $("ocrStatus").className = `ocr-badge ${className}`.trim();
}

async function runAiOcr() {
  const key = $("ocrApiKey").value.trim();
  if (!key) {
    $("ocrApiKey").closest("details").open = true;
    $("ocrApiKey").focus();
    return toast("请先填写免费的 OpenRouter API 密钥。", 3600);
  }
  if (!scanFiles.length) return;
  localStorage.setItem("paperbook_ocr_key", key);
  localStorage.setItem("paperbook_ocr_model", $("ocrModel").value.trim() || "openrouter/free");
  setOcrStatus("AI 识别中…", "working");
  $("aiOcrBtn").disabled = true;
  try {
    const kindPrompt = {
      document:"普通文档",book:"书籍页面",handwriting:"手写笔记",table:"表格",
      card:"证件或名片",receipt:"票据或发票"
    }[scanKind];
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method:"POST",
      headers:{
        "Authorization":`Bearer ${key}`,"Content-Type":"application/json",
        "HTTP-Referer":location.origin,"X-Title":"PaperBook Scan"
      },
      body:JSON.stringify({
        model:$("ocrModel").value.trim() || "openrouter/free",
        messages:[{role:"user",content:[
          {type:"text",text:`你是严谨的 OCR 校对专家。逐字读取这张${kindPrompt}图片。保留原有段落、标题、编号和标点；表格使用 Markdown 表格；看不清的字符用【待确认】标记，绝不猜测。只输出识别后的正文，不要解释。`},
          {type:"image_url",image_url:{url:canvasDataUrl(.9)}}
        ]}],
        temperature:0
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "模型服务请求失败");
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("模型没有返回识别文字");
    scanFiles[activeScanIndex].text = text;
    $("ocrResult").value = text;
    setOcrStatus(text.includes("【待确认】") ? "需复核" : "已识别", text.includes("【待确认】") ? "warn" : "done");
  } catch (error) {
    setOcrStatus("识别失败", "warn");
    toast(error.message || "AI 识别失败，请稍后重试。", 5000);
  } finally {
    $("aiOcrBtn").disabled = false;
  }
}

function addScanRecord() {
  const currentText = $("ocrResult").value.trim();
  if (scanFiles[activeScanIndex]) scanFiles[activeScanIndex].text = currentText;
  const allText = scanFiles.map((item,index)=>item.text ? `<h3>第 ${index+1} 页</h3><p>${esc(item.text).replace(/\n/g,"<br>")}</p>` : "").join("");
  const block = document.createElement("section");
  block.className = "paperbook-scan-block";
  block.innerHTML = `<h2>扫描文档</h2>${allText || `<p>已于 ${new Date().toLocaleString("zh-CN")} 完成 ${scanFiles.length} 页图片采集，尚未识别文字。</p>`}`;
  $("editor").append(block, document.createElement("p"));
  $("editor").dispatchEvent(new Event("input", { bubbles:true }));
  $("scanDialog").close();
  setMobileTab("editor");
  toast("扫描内容已加入当前文档。");
}

function openPlanner() {
  closeMore();
  $("plannerBackdrop").classList.remove("hidden");
  $("plannerPanel").classList.remove("hidden");
  const next = new Date(Date.now()+60*60*1000);
  next.setMinutes(Math.ceil(next.getMinutes()/15)*15,0,0);
  $("scheduleTime").value = `${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,"0")}-${String(next.getDate()).padStart(2,"0")}T${String(next.getHours()).padStart(2,"0")}:${String(next.getMinutes()).padStart(2,"0")}`;
  renderSchedules();
}

function closePlanner() {
  $("plannerBackdrop").classList.add("hidden");
  $("plannerPanel").classList.add("hidden");
}

function saveSchedules() {
  localStorage.setItem("paperbook_schedules", JSON.stringify(schedules));
}

function renderSchedules() {
  const now = new Date();
  $("plannerToday").textContent = new Intl.DateTimeFormat("zh-CN",{month:"long",day:"numeric",weekday:"long"}).format(now);
  const sameDay = value => {
    const date=new Date(value);
    return date.getFullYear()===now.getFullYear()&&date.getMonth()===now.getMonth()&&date.getDate()===now.getDate();
  };
  $("todayEventCount").textContent=schedules.filter(item=>sameDay(item.time)).length;
  $("todoCount").textContent=schedules.filter(item=>!item.done).length;
  const visible=schedules.filter(item=>showCompletedSchedules||!item.done).sort((a,b)=>new Date(a.time)-new Date(b.time));
  $("scheduleList").innerHTML=visible.length ? visible.map(item=>{
    const date=new Date(item.time);
    const day=sameDay(item.time)?"今天":`${date.getMonth()+1}/${date.getDate()}`;
    return `<article class="schedule-item ${item.done?"done":""}">
      <div class="schedule-time">${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}<span>${day}</span></div>
      <div class="schedule-body"><strong>${esc(item.title)}</strong><span>${esc(item.detail||`提前 ${item.reminder} 分钟提醒`)}</span></div>
      <div class="schedule-actions"><button type="button" data-toggle-schedule="${item.id}" title="完成">${item.done?"↶":"✓"}</button><button type="button" data-delete-schedule="${item.id}" title="删除">×</button></div>
    </article>`;
  }).join("") : `<div class="planner-empty">还没有安排。把下一件重要的事放进时间轴吧。</div>`;
}

async function enableNotifications() {
  if (!("Notification" in window)) return toast("此浏览器不支持系统通知。");
  const permission=await Notification.requestPermission();
  toast(permission==="granted" ? "提醒已开启。保持网页打开即可接收通知。" : "未获得通知权限。");
}

function checkScheduleReminders() {
  const now=Date.now();
  let changed=false;
  schedules.forEach(item=>{
    const remindAt=new Date(item.time).getTime()-Number(item.reminder||0)*60000;
    if(!item.done&&!item.notified&&now>=remindAt&&now<new Date(item.time).getTime()+3600000){
      item.notified=true;changed=true;
      if("Notification" in window&&Notification.permission==="granted") new Notification(`PaperBook：${item.title}`,{body:item.detail||"日程即将开始"});
      toast(`提醒：${item.title}`,5000);
    }
  });
  if(changed)saveSchedules();
}

function openVoiceStudio(tab="dictation") {
  closeMore();
  $("voiceBackdrop").classList.remove("hidden");
  $("voiceStudio").classList.remove("hidden");
  setVoiceTab(tab);
  if (tab === "speech") loadCurrentDocumentForSpeech();
}

function closeVoiceStudio() {
  $("voiceBackdrop").classList.add("hidden");
  $("voiceStudio").classList.add("hidden");
}

function setVoiceTab(tab) {
  document.querySelectorAll("[data-voice-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.voiceTab === tab);
  });
  document.querySelectorAll("[data-voice-pane]").forEach(pane => {
    pane.classList.toggle("active", pane.dataset.voicePane === tab);
  });
}

function speechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function createRecognition(kind) {
  const Recognition = speechRecognitionConstructor();
  if (!Recognition) {
    toast("当前浏览器不支持语音识别。建议使用最新版 Chrome、Edge 或 Android App。", 6500);
    return null;
  }
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = kind === "meeting" ? $("dictationLanguage").value : $("dictationLanguage").value;
  recognition.onresult = event => {
    let finalText = "";
    let interimText = "";
    for (let index=event.resultIndex; index<event.results.length; index++) {
      const text = event.results[index][0].transcript;
      if (event.results[index].isFinal) finalText += text + "。";
      else interimText += text;
    }
    if (kind === "meeting") {
      if (finalText) meetingBaseText += finalText;
      $("meetingTranscript").value = meetingBaseText + interimText;
    } else {
      if (finalText) dictationBaseText += finalText;
      $("dictationText").value = dictationBaseText + interimText;
    }
  };
  recognition.onerror = event => {
    const friendly = event.error === "not-allowed" ? "没有获得麦克风权限。" :
      event.error === "no-speech" ? "暂时没有检测到语音。" : `语音识别中断：${event.error}`;
    toast(friendly, 5000);
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      if (kind === "meeting") {
        meetingStartedAt = null;
        meetingRecognition = null;
        clearInterval(meetingTimerId);
        setMeetingRecording(false);
      } else {
        dictationRecognition = null;
        setDictationRecording(false);
      }
    }
  };
  recognition.onend = () => {
    if (kind === "meeting" && meetingStartedAt) {
      try { recognition.start(); } catch {}
      return;
    }
    if (kind === "dictation") setDictationRecording(false);
  };
  return recognition;
}

function setDictationRecording(active) {
  $("dictationRecordBtn").classList.toggle("recording", active);
  $("dictationState").classList.toggle("recording-text", active);
  $("dictationState").textContent = active ? "正在聆听…" : "点击开始口述";
}

function toggleDictation() {
  if (dictationRecognition) {
    dictationRecognition.stop();
    dictationRecognition = null;
    setDictationRecording(false);
    return;
  }
  dictationBaseText = $("dictationText").value.trim();
  if (dictationBaseText && !/[。！？\n]$/.test(dictationBaseText)) dictationBaseText += "。";
  dictationRecognition = createRecognition("dictation");
  if (!dictationRecognition) return;
  dictationRecognition.onend = () => {
    dictationRecognition = null;
    setDictationRecording(false);
  };
  try {
    dictationRecognition.start();
    setDictationRecording(true);
  } catch {
    dictationRecognition = null;
    toast("语音输入启动失败，请稍后重试。");
  }
}

function textToParagraphs(text) {
  return String(text || "").split(/\n+/).map(line => line.trim()).filter(Boolean);
}

function appendTextToEditor(title, text) {
  const section = document.createElement("section");
  section.className = "paperbook-voice-block";
  if (title) {
    const heading = document.createElement("h2");
    heading.textContent = title;
    section.appendChild(heading);
  }
  textToParagraphs(text).forEach(line => {
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    section.appendChild(paragraph);
  });
  $("editor").append(section, document.createElement("p"));
  $("editor").dispatchEvent(new Event("input", { bubbles:true }));
  setMobileTab("editor");
}

function insertDictation() {
  const text = $("dictationText").value.trim();
  if (!text) return toast("还没有可写入的口述文字。");
  appendTextToEditor("语音记录", text);
  closeVoiceStudio();
  toast("语音内容已写入当前文档。");
}

function formatDuration(totalSeconds) {
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2,"0");
  const minutes = String(Math.floor(totalSeconds % 3600 / 60)).padStart(2,"0");
  const seconds = String(totalSeconds % 60).padStart(2,"0");
  return `${hours}:${minutes}:${seconds}`;
}

function updateMeetingTimer() {
  if (!meetingStartedAt) return;
  $("meetingTimer").textContent = formatDuration(Math.floor((Date.now()-meetingStartedAt)/1000));
}

function setMeetingRecording(active) {
  $("meetingIndicator").classList.toggle("live", active);
  $("meetingState").textContent = active ? "正在实时转录" : "会议转录已暂停";
  $("meetingRecordBtn").textContent = active ? "结束会议转录" : "继续会议转录";
  $("meetingMarkerBtn").disabled = !active;
}

function toggleMeetingRecording() {
  if (meetingRecognition) {
    meetingStartedAt = null;
    meetingRecognition.stop();
    meetingRecognition = null;
    clearInterval(meetingTimerId);
    setMeetingRecording(false);
    $("meetingState").textContent = "会议转录已结束";
    $("meetingRecordBtn").textContent = "继续会议转录";
    return;
  }
  meetingBaseText = $("meetingTranscript").value.trim();
  if (meetingBaseText && !meetingBaseText.endsWith("\n")) meetingBaseText += "\n";
  meetingRecognition = createRecognition("meeting");
  if (!meetingRecognition) return;
  meetingStartedAt = Date.now();
  meetingTimerId = setInterval(updateMeetingTimer,1000);
  try {
    meetingRecognition.start();
    setMeetingRecording(true);
  } catch {
    meetingRecognition = null;
    meetingStartedAt = null;
    clearInterval(meetingTimerId);
    toast("会议转录启动失败，请稍后重试。");
  }
}

function addMeetingMarker() {
  const stamp = $("meetingTimer").textContent;
  meetingBaseText = $("meetingTranscript").value.trimEnd() + `\n【重点 ${stamp}】`;
  $("meetingTranscript").value = meetingBaseText;
}

function meetingDocumentText() {
  const title = $("meetingTitle").value.trim() || `会议记录 ${new Date().toLocaleDateString("zh-CN")}`;
  const transcript = $("meetingTranscript").value.trim();
  return {title,transcript};
}

function meetingToDocument() {
  const {title,transcript} = meetingDocumentText();
  if (!transcript) return toast("还没有会议转录内容。");
  appendTextToEditor(title, transcript);
  closeVoiceStudio();
  toast("完整会议转录已写入当前文档。");
}

function uniqueItems(items, limit=6) {
  return [...new Set(items.map(item=>item.trim()).filter(item=>item.length>3))].slice(0,limit);
}

function summarizeMeeting() {
  const {title,transcript} = meetingDocumentText();
  if (transcript.length < 12) return toast("会议内容太少，暂时无法整理。");
  const sentences = (transcript.match(/[^。！？!?\n]+[。！？!?]?/g) || []).map(item=>item.trim()).filter(Boolean);
  const decisions = uniqueItems(sentences.filter(item=>/(决定|确定|结论|一致|通过|采用|确认)/.test(item)));
  const actions = uniqueItems(sentences.filter(item=>/(需要|负责|跟进|完成|提交|截止|安排|下一步|待办)/.test(item)));
  const risks = uniqueItems(sentences.filter(item=>/(风险|问题|阻塞|困难|待确认|不确定|延期|缺少)/.test(item)));
  const highlights = uniqueItems(sentences.filter(item=>item.includes("【重点") || item.length >= 28),5);
  const overview = uniqueItems(sentences.filter(item=>!item.includes("【重点")),3);
  const fallback = ["本次会议已完成转录，请结合原文确认关键结论。"];
  const sections = [
    ["会议概览", overview.length ? overview : fallback],
    ["关键结论", decisions.length ? decisions : ["暂未识别到明确结论。"]],
    ["行动项", actions.length ? actions : ["暂未识别到明确行动项，请人工补充负责人和截止时间。"]],
    ["重点与议题", highlights.length ? highlights : ["暂无额外重点标记。"]],
    ["风险与待确认", risks.length ? risks : ["暂未识别到明确风险。"]]
  ];
  latestMeetingSummary = `# ${title}\n\n` + sections.map(([heading,items]) =>
    `## ${heading}\n${items.map(item=>`- ${item.replace(/^【重点[^】]*】/,"").trim()}`).join("\n")}`
  ).join("\n\n");
  $("meetingSummary").innerHTML = sections.map(([heading,items]) =>
    `<h4>${esc(heading)}</h4><ul>${items.map(item=>`<li>${esc(item.replace(/^【重点[^】]*】/,"").trim())}</li>`).join("")}</ul>`
  ).join("");
  $("meetingSummaryCard").classList.remove("hidden");
  toast("会议内容已完成智能整理。");
}

async function copyMeetingSummary() {
  if (!latestMeetingSummary) return;
  try {
    await navigator.clipboard.writeText(latestMeetingSummary);
    toast("会议纪要已复制。");
  } catch {
    toast("复制失败，请手动选择纪要内容。");
  }
}

function summaryToDocument() {
  if (!latestMeetingSummary) return;
  appendTextToEditor($("meetingTitle").value.trim() || "会议纪要", latestMeetingSummary.replace(/^# .+\n+/,""));
  closeVoiceStudio();
  toast("会议纪要已保存到当前文档。");
}

function loadSpeechVoices() {
  if (!("speechSynthesis" in window)) return;
  speechVoices = speechSynthesis.getVoices();
  const select = $("voiceSelect");
  const previous = select.value;
  select.innerHTML = "";
  speechVoices
    .sort((a,b)=>(a.lang.startsWith("zh")?-1:1)-(b.lang.startsWith("zh")?-1:1))
    .forEach((voice,index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${voice.name} · ${voice.lang}`;
      select.appendChild(option);
    });
  if (previous && [...select.options].some(option=>option.value===previous)) select.value = previous;
}

function loadCurrentDocumentForSpeech() {
  const text = $("editor").textContent.trim();
  $("speechText").value = text;
  $("speechTitle").textContent = $("titleInput").value.trim() || "朗读当前文档";
  $("speechMeta").textContent = text ? `${text.replace(/\s/g,"").length} 字 · 已准备` : "当前文档暂无可朗读文字";
}

function playSpeech() {
  if (!("speechSynthesis" in window)) return toast("当前设备不支持文档朗读。",5000);
  const text = $("speechText").value.trim();
  if (!text) return toast("没有可朗读的文字。");
  speechSynthesis.cancel();
  speechUtterance = new SpeechSynthesisUtterance(text);
  const selectedVoice = speechVoices[Number($("voiceSelect").value)];
  if (selectedVoice) speechUtterance.voice = selectedVoice;
  speechUtterance.rate = Number($("speechRate").value);
  speechUtterance.pitch = Number($("speechPitch").value);
  speechUtterance.lang = selectedVoice?.lang || "zh-CN";
  speechUtterance.onstart = () => $("speechMeta").textContent = "正在朗读…";
  speechUtterance.onend = () => $("speechMeta").textContent = "朗读完成";
  speechUtterance.onerror = () => $("speechMeta").textContent = "朗读已停止";
  speechSynthesis.speak(speechUtterance);
}

function toggleSpeechPause() {
  if (!("speechSynthesis" in window)) return;
  if (speechSynthesis.paused) {
    speechSynthesis.resume();
    $("speechMeta").textContent = "正在朗读…";
  } else {
    speechSynthesis.pause();
    $("speechMeta").textContent = "已暂停";
  }
}

function stopSpeech() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  $("speechMeta").textContent = "已停止";
}

$("loginTab").onclick=()=>setMode("login");
$("signupTab").onclick=()=>setMode("signup");
$("authForm").onsubmit=authSubmit;
$("forgotBtn").onclick=forgotPassword;
$("newNotebookBtn").onclick=newNotebook;
$("renameNotebookBtn").onclick=renameNotebook;
$("newPageBtn").onclick=newPage;
$("deletePageBtn").onclick=deletePage;
$("saveBtn").onclick=saveCurrent;
$("prevBtn").onclick=()=>step(-1);
$("nextBtn").onclick=()=>step(1);
$("bottomPrevBtn").onclick=()=>step(-1);
$("bottomNextBtn").onclick=()=>step(1);
$("jumpBtn").onclick=jumpPage;
$("searchInput").oninput=renderPages;
$("titleInput").oninput=scheduleSave;
$("tagsInput").oninput=scheduleSave;
$("editor").oninput=scheduleSave;
$("exportBtn").onclick=exportBackup;
$("importBtn").onclick=()=>$("importPicker").click();
$("importPicker").onchange=e=>{const f=e.target.files[0];if(f)importBackup(f);e.target.value=""};
$("logoutBtn").onclick=async()=>{await saveCurrent();await supabase.auth.signOut()};
function toggleTheme(){const dark=localStorage.getItem("paperbook_theme")==="dark";localStorage.setItem("paperbook_theme",dark?"light":"dark");applyTheme()}
$("scanCenterBtn").onclick=openScanner;
$("voiceStudioBtn").onclick=()=>openVoiceStudio("dictation");
$("plannerBtn").onclick=openPlanner;
$("mobileNav").onclick=e=>{const button=e.target.closest("[data-mobile-tab]");if(button)setMobileTab(button.dataset.mobileTab)};
$("closeMoreBtn").onclick=closeMore;
$("moreBackdrop").onclick=closeMore;
$("moreScanBtn").onclick=openScanner;
$("moreVoiceBtn").onclick=()=>openVoiceStudio("dictation");
$("morePlannerBtn").onclick=openPlanner;
$("moreThemeBtn").onclick=()=>{toggleTheme();closeMore()};
$("moreExportBtn").onclick=()=>{closeMore();exportBackup()};
$("moreImportBtn").onclick=()=>{closeMore();$("importPicker").click()};
$("moreLogoutBtn").onclick=async()=>{closeMore();await saveCurrent();await supabase.auth.signOut()};
$("cameraScanBtn").onclick=()=>chooseScanImage(true);
$("fileScanBtn").onclick=()=>chooseScanImage(false);
$("appendScanBtn").onclick=()=>chooseScanImage(false);
$("closeScannerBtn").onclick=()=>$("scanDialog").close();
$("scanPicker").onchange=e=>{addScanFiles(e.target.files);e.target.value=""};
$("scanPageList").onclick=e=>{
  const remove=e.target.closest("[data-remove-scan]");
  if(remove){
    const index=Number(remove.dataset.removeScan);
    URL.revokeObjectURL(scanFiles[index].url);
    scanFiles.splice(index,1);
    activeScanIndex=Math.min(activeScanIndex,scanFiles.length-1);
    if(!scanFiles.length){$("scanWorkspace").classList.add("hidden");$("scanEmpty").classList.remove("hidden")}
    else{renderScanPages();renderScanCanvas()}
    return;
  }
  const page=e.target.closest("[data-scan-page]");
  if(page){
    if(scanFiles[activeScanIndex])scanFiles[activeScanIndex].text=$("ocrResult").value;
    activeScanIndex=Number(page.dataset.scanPage);
    renderScanPages();renderScanCanvas();
  }
};
document.querySelectorAll("[data-scan-filter]").forEach(button=>button.onclick=()=>{
  scanFilter=button.dataset.scanFilter;
  document.querySelectorAll("[data-scan-filter]").forEach(item=>item.classList.toggle("active",item===button));
  renderScanCanvas();
});
document.querySelectorAll("[data-scan-kind]").forEach(button=>button.onclick=()=>{
  scanKind=button.dataset.scanKind;
  document.querySelectorAll("[data-scan-kind]").forEach(item=>item.classList.toggle("active",item===button));
});
$("rotateScanBtn").onclick=()=>{if(scanFiles[activeScanIndex]){scanFiles[activeScanIndex].rotation=(scanFiles[activeScanIndex].rotation+90)%360;renderScanCanvas()}};
$("localOcrBtn").onclick=runLocalOcr;
$("aiOcrBtn").onclick=runAiOcr;
$("ocrResult").oninput=()=>{if(scanFiles[activeScanIndex])scanFiles[activeScanIndex].text=$("ocrResult").value};
$("copyOcrBtn").onclick=async()=>{const text=$("ocrResult").value;if(!text)return toast("当前没有可复制的文字。");await navigator.clipboard.writeText(text);toast("识别文字已复制。")};
$("addScanNoteBtn").onclick=addScanRecord;
$("closeVoiceBtn").onclick=closeVoiceStudio;
$("voiceBackdrop").onclick=closeVoiceStudio;
document.querySelectorAll("[data-voice-tab]").forEach(button=>button.onclick=()=>setVoiceTab(button.dataset.voiceTab));
$("dictationRecordBtn").onclick=toggleDictation;
$("clearDictationBtn").onclick=()=>{$("dictationText").value="";dictationBaseText=""};
$("insertDictationBtn").onclick=insertDictation;
$("meetingRecordBtn").onclick=toggleMeetingRecording;
$("meetingMarkerBtn").onclick=addMeetingMarker;
$("meetingToDocBtn").onclick=meetingToDocument;
$("summarizeMeetingBtn").onclick=summarizeMeeting;
$("copySummaryBtn").onclick=copyMeetingSummary;
$("summaryToDocBtn").onclick=summaryToDocument;
$("loadDocumentSpeechBtn").onclick=loadCurrentDocumentForSpeech;
$("speechPlayBtn").onclick=playSpeech;
$("speechPauseBtn").onclick=toggleSpeechPause;
$("speechStopBtn").onclick=stopSpeech;
$("speechRate").oninput=()=>{$("speechRateValue").textContent=`${Number($("speechRate").value).toFixed(1)}×`};
$("speechPitch").oninput=()=>{$("speechPitchValue").textContent=Number($("speechPitch").value).toFixed(1)};
$("ocrApiKey").value=localStorage.getItem("paperbook_ocr_key")||"";
$("ocrModel").value=localStorage.getItem("paperbook_ocr_model")||"openrouter/free";
$("closePlannerBtn").onclick=closePlanner;
$("plannerBackdrop").onclick=closePlanner;
$("enableNotifyBtn").onclick=enableNotifications;
$("scheduleForm").onsubmit=e=>{
  e.preventDefault();
  schedules.push({
    id:crypto.randomUUID(),title:$("scheduleTitle").value.trim(),
    time:$("scheduleTime").value,reminder:Number($("scheduleReminder").value),
    detail:$("scheduleDetail").value.trim(),done:false,notified:false
  });
  saveSchedules();e.target.reset();renderSchedules();toast("日程已保存。");
};
$("scheduleList").onclick=e=>{
  const toggle=e.target.closest("[data-toggle-schedule]");
  const remove=e.target.closest("[data-delete-schedule]");
  if(toggle){const item=schedules.find(value=>value.id===toggle.dataset.toggleSchedule);if(item)item.done=!item.done}
  if(remove)schedules=schedules.filter(value=>value.id!==remove.dataset.deleteSchedule);
  saveSchedules();renderSchedules();
};
$("showAllSchedulesBtn").onclick=()=>{showCompletedSchedules=!showCompletedSchedules;$("showAllSchedulesBtn").textContent=showCompletedSchedules?"仅待办":"全部";renderSchedules()};
renderSchedules();
checkScheduleReminders();
setInterval(checkScheduleReminders,30000);

document.querySelectorAll("[data-cmd]").forEach(b=>b.onclick=()=>{document.execCommand(b.dataset.cmd,false,null);$("editor").focus();scheduleSave()});
document.querySelectorAll("[data-block]").forEach(b=>b.onclick=()=>{document.execCommand("formatBlock",false,b.dataset.block);$("editor").focus();scheduleSave()});

$("promptDialog").addEventListener("close",()=>{
  const ok=$("promptDialog").returnValue==="default";
  resolvePrompt(ok?$("promptInput").value.trim():"");
});
$("promptConfirm").onclick=()=>{$("promptDialog").returnValue="default"};

window.addEventListener("online",()=>setSync("网络已恢复"));
window.addEventListener("offline",()=>setSync("当前离线"));
window.addEventListener("beforeunload",()=>{clearTimeout(saveTimer)});
window.addEventListener("beforeunload",()=>{stopSpeech();clearInterval(meetingTimerId)});
document.addEventListener("click",event=>{
  if(event.target.closest("#notebookList .item"))setTimeout(()=>setMobileTab("pages"),60);
  if(event.target.closest("#pageList .item,#newPageBtn"))setTimeout(()=>setMobileTab("editor"),100);
},true);

document.addEventListener("keydown",e=>{
  if(e.ctrlKey&&e.key.toLowerCase()==="s"){e.preventDefault();saveCurrent()}
  if(e.ctrlKey&&e.key.toLowerCase()==="f"){e.preventDefault();$("searchInput").focus()}
  if(e.ctrlKey&&e.key.toLowerCase()==="n"){e.preventDefault();newPage()}
  if(e.ctrlKey&&e.key==="ArrowLeft"){e.preventDefault();step(-1)}
  if(e.ctrlKey&&e.key==="ArrowRight"){e.preventDefault();step(1)}
});

supabase.auth.onAuthStateChange(async (_event,newSession)=>{
  session=newSession;
  if(!session){showAuth();return}
  showApp();
  try{await bootstrap()}catch(error){toast(error.message,7000);setSync("初始化失败")}
});

applyTheme();
loadSpeechVoices();
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged=loadSpeechVoices;
setMobileTab("books");
setMode("login");
const {data:{session:initialSession}}=await supabase.auth.getSession();
session=initialSession;
if(session){showApp();try{await bootstrap()}catch(error){toast(error.message,7000)}}
else showAuth();

if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
