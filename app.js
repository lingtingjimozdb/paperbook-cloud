
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

function toast(message, timeout=2600) {
  $("toast").textContent = message;
  $("toast").classList.remove("hidden");
  setTimeout(() => $("toast").classList.add("hidden"), timeout);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
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
  $("authScreen").classList.remove("hidden");
  $("app").classList.add("hidden");
}

function showApp() {
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

  // Ensure every authenticated account has a private workspace.
  // This also repairs accounts created before the original database trigger existed.
  const { data: ensuredWorkspaceId, error: ensureError } = await supabase
    .rpc("ensure_private_workspace");

  if (ensureError) throw ensureError;
  if (!ensuredWorkspaceId) {
    throw new Error("无法创建私人工作区，请先执行数据库修复 SQL。");
  }

  workspaceId = ensuredWorkspaceId;
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
  $("editor").innerHTML = p.content_json?.html || "";
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
  const html = $("editor").innerHTML;
  const temp = document.createElement("div");
  temp.innerHTML = html;
  return {
    title: $("titleInput").value.trim() || "无标题页",
    html,
    plainText: temp.textContent || "",
    tags: $("tagsInput").value.split(/[,，]/).map(x=>x.trim()).filter(Boolean)
  };
}

function scheduleSave() {
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
      content_json:oldPage.content_json||{html:""},
      plain_text:oldPage.plain_text||"",
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
$("themeBtn").onclick=()=>{const dark=localStorage.getItem("paperbook_theme")==="dark";localStorage.setItem("paperbook_theme",dark?"light":"dark");applyTheme()};

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
setMode("login");
const {data:{session:initialSession}}=await supabase.auth.getSession();
session=initialSession;
if(session){showApp();try{await bootstrap()}catch(error){toast(error.message,7000)}}
else showAuth();

if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
