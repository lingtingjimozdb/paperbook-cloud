
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
let scheduleView = "today";

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

function normalizeEmail(value) { return String(value || "").trim().toLowerCase(); }
function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "请输入有效的邮箱地址。";
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
  $("emailInput").placeholder = next === "login" ? "输入注册邮箱" : "输入可接收验证邮件的邮箱";
}

async function authSubmit(event) {
  event.preventDefault();

  const email = normalizeEmail($("emailInput").value);
  const emailError = validateEmail(email);
  if (emailError) return toast(emailError, 4200);
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
          emailRedirectTo: `${location.origin}${location.pathname}`,
          data: { display_name: email.split("@")[0] }
        }
      });
      if (error) throw error;

      if (data.session) {
        toast("注册成功，已自动登录。");
      } else {
        toast("注册成功。请查收验证邮件并点击确认链接后登录。", 7000);
      }
    }
  } catch (error) {
    const message = String(error?.message || "");
    if (/invalid login credentials/i.test(message)) {
      toast("邮箱或密码不正确，或邮箱尚未完成验证。", 5000);
    } else if (/user already registered/i.test(message)) {
      toast("这个邮箱已经注册，请直接登录或重置密码。", 5000);
    } else {
      toast(message || "操作失败", 5000);
    }
  } finally {
    $("authSubmit").disabled = false;
  }
}

async function forgotPassword() {
  $("forgotEmailInput").value = normalizeEmail($("emailInput").value);
  $("forgotPasswordDialog").showModal();
}

async function sendPasswordReset(event) {
  event.preventDefault();
  const email = normalizeEmail($("forgotEmailInput").value);
  const errorText = validateEmail(email);
  if (errorText) return toast(errorText, 4200);
  $("sendResetEmailBtn").disabled = true;
  try {
    const redirectTo = `${location.origin}${location.pathname}?recovery=1`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
    $("forgotPasswordDialog").close();
    toast("重置邮件已发送，请打开邮箱并点击链接。也请检查垃圾邮件箱。", 7500);
  } catch (error) {
    toast(error?.message || "重置邮件发送失败。", 5500);
  } finally {
    $("sendResetEmailBtn").disabled = false;
  }
}

function openPasswordDialog(recovery=false) {
  $("passwordDialog").dataset.recovery = recovery ? "true" : "false";
  $("passwordDialogTitle").textContent = recovery ? "设置新密码" : "修改密码";
  $("passwordDialogHelp").textContent = recovery
    ? "邮箱验证已通过，请设置新的登录密码。"
    : "先验证当前密码，再设置新密码。";
  $("currentPasswordLabel").classList.toggle("hidden", recovery);
  $("currentPasswordInput").required = !recovery;
  $("currentPasswordInput").value = "";
  $("newPasswordInput").value = "";
  $("confirmPasswordInput").value = "";
  $("passwordDialog").showModal();
}

async function updatePassword(event) {
  event.preventDefault();
  const recovery = $("passwordDialog").dataset.recovery === "true";
  const currentPassword = $("currentPasswordInput").value;
  const newPassword = $("newPasswordInput").value;
  const confirmation = $("confirmPasswordInput").value;
  if (newPassword.length < 8) return toast("新密码至少需要 8 位。", 4200);
  if (newPassword !== confirmation) return toast("两次输入的新密码不一致。", 4200);
  if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return toast("新密码请同时包含字母和数字。", 4200);
  }
  $("confirmPasswordBtn").disabled = true;
  try {
    if (!recovery) {
      const email = session?.user?.email;
      if (!email) throw new Error("没有找到当前登录邮箱。");
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email,
        password:currentPassword
      });
      if (verifyError) throw new Error("当前密码不正确。");
    }
    const { error } = await supabase.auth.updateUser({password:newPassword});
    if (error) throw error;
    $("passwordDialog").close();
    history.replaceState({}, "", location.pathname);
    toast("密码修改成功，请妥善保存新密码。", 6000);
  } catch (error) {
    toast(error?.message || "密码修改失败。", 5500);
  } finally {
    $("confirmPasswordBtn").disabled = false;
  }
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

function applySidebarState() {
  const collapsed=localStorage.getItem("paperbook_sidebar_collapsed")==="true";
  document.body.classList.toggle("nav-collapsed",collapsed);
  const button=$("toggleSidebarBtn");
  if(button){
    button.textContent=collapsed?"☰ 展开侧栏":"☰ 收起侧栏";
    button.setAttribute("aria-expanded",String(!collapsed));
    button.title=collapsed?"展开笔记本与页面目录（Alt + \\）":"收起笔记本与页面目录（Alt + \\）";
  }
}

function toggleSidebar() {
  localStorage.setItem("paperbook_sidebar_collapsed",String(!document.body.classList.contains("nav-collapsed")));
  applySidebarState();
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
  scanFiles.push(...images.map(file => ({file, url:URL.createObjectURL(file), rotation:0, text:"", rawText:""})));
  activeScanIndex = Math.max(0, scanFiles.length - images.length);
  $("scanEmpty").classList.add("hidden");
  $("scanWorkspace").classList.remove("hidden");
  renderScanPages();
  renderScanCanvas();
}

window.__paperbookReceiveNativeScanPage = async function(title, rawText, dataUrl, index, total) {
  try {
    if (Number(index) === 0) {
      scanFiles.forEach(item => { if (item.url?.startsWith("blob:")) URL.revokeObjectURL(item.url) });
      scanFiles = [];
    }
    const response = await fetch(String(dataUrl));
    const blob = await response.blob();
    const pageNumber = Number(index) + 1;
    const file = new File([blob], `PaperBook_原生扫描_${pageNumber}.jpg`, {type:"image/jpeg"});
    scanFiles.push({
      file,
      url:URL.createObjectURL(blob),
      rotation:0,
      text:String(rawText || "").trim(),
      rawText:String(rawText || "").trim(),
      nativeScan:true
    });
    activeScanIndex = scanFiles.length - 1;
    if (!$("scanDialog").open) openScanner();
    $("scanEmpty").classList.add("hidden");
    $("scanWorkspace").classList.remove("hidden");
    renderScanPages();
    await renderScanCanvas();
    setOcrStatus("设备已识别 · 建议 AI 恢复", "warn");
    if (scanFiles.length === Number(total)) {
      activeScanIndex = 0;
      renderScanPages();
      await renderScanCanvas();
      toast(`已接收 ${total} 页原生扫描。点击“AI 识别并纠正”核对原图。`, 5200);
    }
    return true;
  } catch (error) {
    toast(`接收原生扫描页失败：${error.message}`, 5000);
    return false;
  }
};

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
  image.src = item.url;
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject});
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
  $("ocrResult").value = item.text || "";
  $("ocrRawResult").textContent = item.rawText || "";
  $("ocrComparePanel").classList.toggle("hidden", !item.rawText || item.rawText === item.text);
}

function canvasDataUrl(quality=.9) {
  return $("scanCanvas").toDataURL("image/jpeg", quality);
}

function downloadBlob(blob,name) {
  const link=document.createElement("a");
  link.href=URL.createObjectURL(blob);link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}

function autoCropScan() {
  const source=$("scanCanvas"),context=source.getContext("2d",{willReadFrequently:true});
  const {data,width,height}=context.getImageData(0,0,source.width,source.height);
  let left=width,top=height,right=0,bottom=0;
  for(let y=0;y<height;y+=2)for(let x=0;x<width;x+=2){
    const i=(y*width+x)*4;
    if(data[i]<242||data[i+1]<242||data[i+2]<242){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}
  }
  if(right<=left||bottom<=top||((right-left)*(bottom-top)>width*height*.94))return toast("没有检测到可去除的明显白边。");
  const margin=12;
  left=Math.max(0,left-margin);top=Math.max(0,top-margin);right=Math.min(width,right+margin);bottom=Math.min(height,bottom+margin);
  const output=document.createElement("canvas");output.width=right-left;output.height=bottom-top;
  output.getContext("2d").drawImage(source,left,top,output.width,output.height,0,0,output.width,output.height);
  output.toBlob(blob=>{
    const item=scanFiles[activeScanIndex];URL.revokeObjectURL(item.url);
    item.file=new File([blob],item.file.name,{type:"image/jpeg"});item.url=URL.createObjectURL(blob);item.rotation=0;
    renderScanPages();renderScanCanvas();toast("已自动去除白边。");
  },"image/jpeg",.94);
}

async function batchAiOcr() {
  if(!scanFiles.length)return;
  const start=activeScanIndex;
  $("batchAiOcrBtn").disabled=true;
  try{
    for(let index=0;index<scanFiles.length;index++){
      activeScanIndex=index;renderScanPages();await renderScanCanvas();await new Promise(resolve=>setTimeout(resolve,120));
      await runAiOcr();
    }
    toast(`已完成 ${scanFiles.length} 页识别。`);
  }finally{activeScanIndex=start;renderScanPages();renderScanCanvas();$("batchAiOcrBtn").disabled=false}
}

function exportScanText() {
  const text=scanFiles.map((item,index)=>`第 ${index+1} 页\n${item.text||"（未识别）"}`).join("\n\n");
  downloadBlob(new Blob([text],{type:"text/plain;charset=utf-8"}),`PaperBook_扫描文字_${new Date().toISOString().slice(0,10)}.txt`);
}

async function exportScanPdf() {
  if(!window.jspdf?.jsPDF)return toast("PDF 组件尚未加载，请检查网络后重试。");
  const {jsPDF}=window.jspdf;
  const pdf=new jsPDF({unit:"mm",format:"a4",orientation:"portrait"});
  for(let index=0;index<scanFiles.length;index++){
    if(index)pdf.addPage();
    const image=await new Promise((resolve,reject)=>{const value=new Image();value.onload=()=>resolve(value);value.onerror=reject;value.src=scanFiles[index].url});
    const ratio=Math.min(190/image.width,277/image.height);
    const width=image.width*ratio,height=image.height*ratio;
    pdf.addImage(image,"JPEG",(210-width)/2,(297-height)/2,width,height,undefined,"FAST");
  }
  pdf.save(`PaperBook_扫描_${new Date().toISOString().slice(0,10)}.pdf`);
}

async function runLocalOcr() {
  if (window.AndroidBridge && typeof window.AndroidBridge.openScanner === "function") {
    window.AndroidBridge.openScanner();
    return;
  }
  if (!window.Tesseract) return toast("本机识别组件尚未加载，请检查网络后重试。", 4500);
  setOcrStatus("本机识别中…", "working");
  $("localOcrBtn").disabled=true;
  try {
    const result=await Tesseract.recognize(canvasDataUrl(.92),"chi_sim+eng",{
      logger:message=>{if(message.status==="recognizing text")setOcrStatus(`识别 ${Math.round(message.progress*100)}%`,"working")}
    });
    const text=result?.data?.text?.trim()||"";
    if(!text)throw new Error("没有识别到清晰文字");
    scanFiles[activeScanIndex].rawText=text;
    scanFiles[activeScanIndex].text=text;
    $("ocrResult").value=text;
    $("ocrRawResult").textContent=text;
    $("ocrComparePanel").classList.add("hidden");
    setOcrStatus("本机已识别","done");
  } catch(error) {
    setOcrStatus("识别失败","warn");toast(error.message||"本机识别失败。",4500);
  } finally {$("localOcrBtn").disabled=false}
}

function setOcrStatus(text, className="") {
  $("ocrStatus").textContent = text;
  $("ocrStatus").className = `ocr-badge ${className}`.trim();
}

async function runAiOcr() {
  const provider=$("ocrProvider").value;
  if(provider==="local")return runLocalOcr();
  const key = $("ocrApiKey").value.trim();
  if (!key) {
    $("ocrApiKey").closest("details").open = true;
    $("ocrApiKey").focus();
    return toast("请先填写免费的 OpenRouter API 密钥。", 3600);
  }
  if (!scanFiles.length) return;
  localStorage.setItem("paperbook_ocr_key", key);
  localStorage.setItem("paperbook_ocr_model", $("ocrModel").value.trim() || "openrouter/free");
  localStorage.setItem("paperbook_ocr_provider", provider);
  setOcrStatus("AI 正在核对原图…", "working");
  $("aiOcrBtn").disabled = true;
  try {
    const item = scanFiles[activeScanIndex];
    const rawDraft = (item.rawText || item.text || $("ocrResult").value || "").trim();
    const kindPrompt = {
      document:"普通文档",book:"书籍页面",handwriting:"手写笔记",table:"表格",
      card:"证件或名片",receipt:"票据或发票"
    }[scanKind];
    const restoreMode = $("ocrRestoreMode").value;
    const modeRule = restoreMode==="layout"
      ? "重点恢复标题层级、段落、列表、表格行列；表格用 Markdown 表格表示。"
      : restoreMode==="handwriting"
        ? "重点辨认手写连笔和上下文，但不得为了语句通顺而编造原图没有的内容。"
        : "严格逐字还原，不润色、不改写、不总结。";
    const prompt=`你是 PaperBook 的文档图像恢复与 OCR 终审专家。请以原图为最高证据，交叉核对设备 OCR 草稿，恢复这张${kindPrompt}的真实文字。

硬性规则：
1. ${modeRule}
2. 纠正形近字、同音字、断行、粘连、重复和漏字；保留原有标题、段落、编号、标点及阅读顺序。
3. 数字、金额、日期、姓名、专有名词、公式和证件字段必须逐字符核对，不能依靠常识猜测。
4. 草稿与图片冲突时服从图片；图片确实无法确认时写【待确认：可能为X】。不要静默臆测。
5. 不要输出说明、评价、Markdown 代码围栏或“识别结果”等前缀，只输出恢复后的正文。

设备 OCR 草稿（可能有错，也可能为空）：
---草稿开始---
${rawDraft || "（无草稿，请直接读取原图）"}
---草稿结束---`;
    const response = provider==="gemini"
      ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent($("ocrModel").value.trim()||"gemini-3.6-flash")}:generateContent?key=${encodeURIComponent(key)}`,{
          method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt},{inline_data:{mime_type:"image/jpeg",data:canvasDataUrl(.94).split(",")[1]}}]}],generationConfig:{temperature:0,topP:.1}})
        })
      : await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method:"POST",headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json","HTTP-Referer":location.origin,"X-Title":"PaperBook Scan"},
          body:JSON.stringify({model:$("ocrModel").value.trim()||"openrouter/free",messages:[{role:"user",content:[{type:"text",text:prompt},{type:"image_url",image_url:{url:canvasDataUrl(.94)}}]}],temperature:0,top_p:.1})
        });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "模型服务请求失败");
    const text = (provider==="gemini" ? data?.candidates?.[0]?.content?.parts?.map(part=>part.text||"").join("") : data?.choices?.[0]?.message?.content)?.trim();
    if (!text) throw new Error("模型没有返回识别文字");
    if (!item.rawText) item.rawText = rawDraft;
    item.text = text;
    $("ocrResult").value = text;
    $("ocrRawResult").textContent = item.rawText || "";
    $("ocrComparePanel").classList.toggle("hidden", !item.rawText || item.rawText === text);
    setOcrStatus(text.includes("【待确认") ? "AI 已恢复 · 需复核" : "AI 已恢复", text.includes("【待确认") ? "warn" : "done");
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
  const rangeEnd=scheduleView==="today" ? new Date(now.getFullYear(),now.getMonth(),now.getDate()+1).getTime() :
    scheduleView==="week" ? now.getTime()+7*86400000 : Infinity;
  const visible=schedules.filter(item=>{
    const timestamp=new Date(item.time).getTime();
    return (scheduleView==="all"||timestamp<rangeEnd)&&(showCompletedSchedules||!item.done);
  }).sort((a,b)=>new Date(a.time)-new Date(b.time));
  const categoryNames={work:"工作",study:"学习",meeting:"会议",personal:"个人"};
  const repeatNames={daily:"每天重复",weekly:"每周重复",monthly:"每月重复"};
  $("scheduleList").innerHTML=visible.length ? visible.map(item=>{
    const date=new Date(item.time);
    const day=sameDay(item.time)?"今天":`${date.getMonth()+1}/${date.getDate()}`;
    return `<article class="schedule-item ${item.done?"done":""}">
      <div class="schedule-time">${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}<span>${day}</span></div>
      <div class="schedule-body"><strong>${esc(item.title)}</strong><span class="schedule-category">${categoryNames[item.category]||"工作"}${repeatNames[item.repeat]?` · ${repeatNames[item.repeat]}`:""}</span><span>${esc(item.detail||`提前 ${item.reminder} 分钟提醒`)}</span></div>
      <div class="schedule-actions"><button type="button" data-edit-schedule="${item.id}" title="编辑">✎</button><button type="button" data-toggle-schedule="${item.id}" title="完成">${item.done?"↶":"✓"}</button><button type="button" data-delete-schedule="${item.id}" title="删除">×</button></div>
    </article>`;
  }).join("") : `<div class="planner-empty">还没有安排。把下一件重要的事放进时间轴吧。</div>`;
}

function resetScheduleForm() {
  $("scheduleForm").reset();$("scheduleEditId").value="";
  $("saveScheduleBtn").textContent="保存日程";$("cancelScheduleEditBtn").classList.add("hidden");
}

function editSchedule(id) {
  const item=schedules.find(value=>value.id===id);if(!item)return;
  $("scheduleTitle").value=item.title;$("scheduleTime").value=item.time;
  $("scheduleReminder").value=String(item.reminder);$("scheduleRepeat").value=item.repeat||"none";
  $("scheduleCategory").value=item.category||"work";$("scheduleDetail").value=item.detail||"";
  $("scheduleEditId").value=id;$("saveScheduleBtn").textContent="保存修改";
  $("cancelScheduleEditBtn").classList.remove("hidden");$("scheduleTitle").focus();
}

function nextRepeatTime(item) {
  const next=new Date(item.time);
  if(item.repeat==="daily")next.setDate(next.getDate()+1);
  if(item.repeat==="weekly")next.setDate(next.getDate()+7);
  if(item.repeat==="monthly")next.setMonth(next.getMonth()+1);
  return next;
}

function exportCalendar() {
  const pad=value=>String(value).padStart(2,"0");
  const format=value=>{const d=new Date(value);return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`};
  const escapeIcs=value=>String(value||"").replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");
  const events=schedules.filter(item=>!item.done).map(item=>`BEGIN:VEVENT\nUID:${item.id}@paperbook\nDTSTAMP:${format(new Date())}\nDTSTART:${format(item.time)}\nSUMMARY:${escapeIcs(item.title)}\nDESCRIPTION:${escapeIcs(item.detail)}\nBEGIN:VALARM\nTRIGGER:-PT${item.reminder||0}M\nACTION:DISPLAY\nDESCRIPTION:${escapeIcs(item.title)}\nEND:VALARM\nEND:VEVENT`).join("\n");
  downloadBlob(new Blob([`BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//PaperBook//Schedule//ZH\n${events}\nEND:VCALENDAR`],{type:"text/calendar;charset=utf-8"}),`PaperBook_日程_${new Date().toISOString().slice(0,10)}.ics`);
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
$("sendResetEmailBtn").onclick=sendPasswordReset;
$("confirmPasswordBtn").onclick=updatePassword;
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
$("changePasswordBtn").onclick=()=>openPasswordDialog(false);
$("logoutBtn").onclick=async()=>{await saveCurrent();await supabase.auth.signOut()};
function toggleTheme(){const dark=localStorage.getItem("paperbook_theme")==="dark";localStorage.setItem("paperbook_theme",dark?"light":"dark");applyTheme()}
$("scanCenterBtn").onclick=openScanner;
$("voiceStudioBtn").onclick=()=>openVoiceStudio("dictation");
$("plannerBtn").onclick=openPlanner;
$("toggleSidebarBtn").onclick=toggleSidebar;
$("mobileNav").onclick=e=>{const button=e.target.closest("[data-mobile-tab]");if(button)setMobileTab(button.dataset.mobileTab)};
$("closeMoreBtn").onclick=closeMore;
$("moreBackdrop").onclick=closeMore;
$("moreScanBtn").onclick=openScanner;
$("moreVoiceBtn").onclick=()=>openVoiceStudio("dictation");
$("morePlannerBtn").onclick=openPlanner;
$("moreThemeBtn").onclick=()=>{toggleTheme();closeMore()};
$("moreExportBtn").onclick=()=>{closeMore();exportBackup()};
$("moreImportBtn").onclick=()=>{closeMore();$("importPicker").click()};
$("moreChangePasswordBtn").onclick=()=>{closeMore();openPasswordDialog(false)};
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
$("autoCropScanBtn").onclick=autoCropScan;
$("localOcrBtn").onclick=runLocalOcr;
$("aiOcrBtn").onclick=runAiOcr;
$("batchAiOcrBtn").onclick=batchAiOcr;
$("ocrResult").oninput=()=>{if(scanFiles[activeScanIndex])scanFiles[activeScanIndex].text=$("ocrResult").value};
$("copyOcrBtn").onclick=async()=>{const text=$("ocrResult").value;if(!text)return toast("当前没有可复制的文字。");await navigator.clipboard.writeText(text);toast("识别文字已复制。")};
$("exportScanPdfBtn").onclick=exportScanPdf;
$("exportScanTextBtn").onclick=exportScanText;
$("downloadScanImageBtn").onclick=()=>{const file=scanFiles[activeScanIndex]?.file;if(!file)return toast("请先添加扫描图片。");downloadBlob(file,`PaperBook_扫描_${activeScanIndex+1}.jpg`)};
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
$("ocrProvider").value=localStorage.getItem("paperbook_ocr_provider")||"local";
$("ocrRestoreMode").value=localStorage.getItem("paperbook_ocr_restore_mode")||"strict";
$("ocrRestoreMode").onchange=()=>localStorage.setItem("paperbook_ocr_restore_mode",$("ocrRestoreMode").value);
$("ocrProvider").onchange=()=>{
  const provider=$("ocrProvider").value;
  localStorage.setItem("paperbook_ocr_provider",provider);
  $("ocrModel").value=provider==="gemini"?"gemini-3.6-flash":provider==="openrouter"?"openrouter/free":"本机 Tesseract OCR";
  $("ocrApiKey").disabled=provider==="local";$("ocrModel").disabled=provider==="local";
};
$("ocrProvider").dispatchEvent(new Event("change"));
$("closePlannerBtn").onclick=closePlanner;
$("plannerBackdrop").onclick=closePlanner;
$("enableNotifyBtn").onclick=enableNotifications;
$("scheduleForm").onsubmit=e=>{
  e.preventDefault();
  const id=$("scheduleEditId").value;
  const value={id:id||crypto.randomUUID(),title:$("scheduleTitle").value.trim(),
    time:$("scheduleTime").value,reminder:Number($("scheduleReminder").value),
    repeat:$("scheduleRepeat").value,category:$("scheduleCategory").value,
    detail:$("scheduleDetail").value.trim(),done:false,notified:false};
  if(id){const index=schedules.findIndex(item=>item.id===id);if(index>=0)schedules[index]={...schedules[index],...value}}
  else schedules.push(value);
  saveSchedules();resetScheduleForm();renderSchedules();toast(id?"日程已更新。":"日程已保存。");
};
$("scheduleList").onclick=e=>{
  const toggle=e.target.closest("[data-toggle-schedule]");
  const remove=e.target.closest("[data-delete-schedule]");
  const edit=e.target.closest("[data-edit-schedule]");
  if(edit)return editSchedule(edit.dataset.editSchedule);
  if(toggle){const item=schedules.find(value=>value.id===toggle.dataset.toggleSchedule);if(item){item.done=!item.done;if(item.done&&item.repeat&&item.repeat!=="none"){const next=nextRepeatTime(item);schedules.push({...item,id:crypto.randomUUID(),time:`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,"0")}-${String(next.getDate()).padStart(2,"0")}T${String(next.getHours()).padStart(2,"0")}:${String(next.getMinutes()).padStart(2,"0")}`,done:false,notified:false})}}}
  if(remove)schedules=schedules.filter(value=>value.id!==remove.dataset.deleteSchedule);
  saveSchedules();renderSchedules();
};
$("cancelScheduleEditBtn").onclick=resetScheduleForm;
document.querySelectorAll("[data-schedule-view]").forEach(button=>button.onclick=()=>{
  scheduleView=button.dataset.scheduleView;
  document.querySelectorAll("[data-schedule-view]").forEach(item=>item.classList.toggle("active",item===button));
  renderSchedules();
});
$("exportCalendarBtn").onclick=exportCalendar;
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
  if(e.altKey&&e.key==="\\"){e.preventDefault();toggleSidebar()}
  if(e.ctrlKey&&e.key.toLowerCase()==="s"){e.preventDefault();saveCurrent()}
  if(e.ctrlKey&&e.key.toLowerCase()==="f"){e.preventDefault();$("searchInput").focus()}
  if(e.ctrlKey&&e.key.toLowerCase()==="n"){e.preventDefault();newPage()}
  if(e.ctrlKey&&e.key==="ArrowLeft"){e.preventDefault();step(-1)}
  if(e.ctrlKey&&e.key==="ArrowRight"){e.preventDefault();step(1)}
});

supabase.auth.onAuthStateChange(async (event,newSession)=>{
  session=newSession;
  if(!session){showAuth();return}
  showApp();
  try{await bootstrap()}catch(error){toast(error.message,7000);setSync("初始化失败")}
  if(event==="PASSWORD_RECOVERY")setTimeout(()=>openPasswordDialog(true),120);
});

applyTheme();
applySidebarState();
loadSpeechVoices();
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged=loadSpeechVoices;
setMobileTab("books");
setMode("login");
const {data:{session:initialSession}}=await supabase.auth.getSession();
session=initialSession;
if(session){
  showApp();
  try{await bootstrap()}catch(error){toast(error.message,7000)}
  if(new URLSearchParams(location.search).get("recovery")==="1")setTimeout(()=>openPasswordDialog(true),120);
}
else showAuth();

if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
