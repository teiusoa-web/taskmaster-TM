
import { Auth } from './auth.js';
import { API_BASE } from './api-config.js';

const TASKS_KEY = 'DACK_TASKS_LIST';
const CATEGORIES_KEY = 'DACK_CATEGORIES_LIST';
let tasks = [];
let categories = [];
let ready = false;
let initPromise = null;
let apiAvailable = false;

async function request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  if (!response.ok) throw new Error(`API request failed (${response.status})`);
  if (response.status === 204) return null;
  return response.json();
}

function cache() {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
}

export const Storage = {
  init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      try {
        const [remoteTasks, remoteCategories] = await Promise.all([request('/tasks'), request('/categories')]);
        tasks = Array.isArray(remoteTasks) ? remoteTasks : [];
        categories = Array.isArray(remoteCategories) ? remoteCategories : [];
        apiAvailable = true;
        ready = true;
        cache();
      } catch (error) {
        console.warn('Task API unavailable; using this browser\'s local cache.', error);
        try { tasks = JSON.parse(localStorage.getItem(TASKS_KEY) || '[]'); } catch { tasks = []; }
        try { categories = JSON.parse(localStorage.getItem(CATEGORIES_KEY) || '[]'); } catch { categories = []; }
        apiAvailable = false;
        ready = true;
      }
      return true;
    })();
    return initPromise;
  },

  isReady() { return ready; },
  isApiAvailable() { return apiAvailable; },
  getTasks() { return Auth.getTasks(tasks); },
  getCategories() { return categories.slice(); },
  saveTasks(nextTasks) {
    const previous = tasks;
    const previousById = new Map(previous.map(task => [task.id, task]));
    const nextById = new Map(nextTasks.map(task => [task.id, task]));
    const removed = previous.filter(task => !nextById.has(task.id));
    const added = nextTasks.filter(task => !previousById.has(task.id));
    const updated = nextTasks.filter(task => previousById.has(task.id));
    tasks = nextTasks; cache();
    if (!apiAvailable) return true;
    const changes = Promise.all([
      ...removed.map(task => request(`/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' })),
      ...added.map(task => request('/tasks', { method: 'POST', body: JSON.stringify(task) })),
      ...updated.map(task => request(`/tasks/${encodeURIComponent(task.id)}`, { method: 'PUT', body: JSON.stringify(task) }))
    ]);
    if (!added.length && !removed.length) { changes.catch(error => console.error('Could not sync task updates.', error)); return true; }
    return changes.then(() => true).catch(error => { tasks = previous; cache(); console.error('Could not save tasks to API.', error); return false; });
  },
  getTaskById(id) {
    const task = tasks.find(item => item.id === id) || null;
    return task && Auth.canAccessTask(task) ? task : null;
  },
  addTask(task) {
    const user = Auth.getCurrentUser();
    if (!Auth.canCreateTask() || !user || !task || typeof task !== 'object') return false;
    const newTask = { ...task, ownerId: user.id, status: 'pending', activity: [{ id: `activity_${Date.now()}`, type: 'created', text: 'T蘯｡o cﾃｴng vi盻㌘', userId: user.id, userName: user.name, createdAt: new Date().toISOString() }] };
    tasks.unshift(newTask); cache();
    return apiAvailable ? request('/tasks', { method: 'POST', body: JSON.stringify(newTask) }).then(() => true).catch(error => { tasks.shift(); cache(); console.error(error); return false; }) : true;
  },
  addTaskReport(id, text, attachments = []) {
    const task = tasks.find(item => item.id === id);
    if (!task || !Auth.canReportTask(task) || !String(text || '').trim()) return false;
    const user = Auth.getCurrentUser(); task.reports ||= [];
    task.reports.unshift({ id: `report_${Date.now()}`, text: text.trim(), attachments, userId: user.id, username: user.username, createdAt: new Date().toISOString(), type: 'progress', review: null });
    if (task.status === 'needs-revision') task.status = 'in-progress';
    return this._commit(task, 'progress', 'Đã gửi báo cáo tiến độ');
  },
  addTaskComment(id, text) {
    const task = tasks.find(item => item.id === id); const user = Auth.getCurrentUser(); const content = String(text || '').trim();
    if (!task || !user || !content || !Auth.canAccessTask(task)) return false;
    task.comments ||= []; task.comments.unshift({ id: `comment_${Date.now()}`, text: content, userId: user.id, username: user.username, name: user.name, createdAt: new Date().toISOString() });
    return this._commit(task, 'comment', 'ﾄ静｣ thﾃｪm bﾃｬnh lu蘯ｭn');
  },
  requestDeadlineChange(id, deadline, reason) {
    const user = Auth.getCurrentUser(); const task = tasks.find(item => item.id === id); const note = String(reason || '').trim();
    if (!user || !['user','manager'].includes(user.role) || !task || task.assigneeId !== user.id || !deadline || !note || ['completed','cancelled'].includes(task.status) || task.deadlineChangeRequest?.status === 'pending') return false;
    task.deadlineChangeRequest = { status:'pending', requestedDeadline:deadline, reason:note, requestedBy:user.id, requestedByName:user.name, requestedAt:new Date().toISOString() };
    return this._commit(task, 'deadline-request', 'ﾄ静｣ yﾃｪu c蘯ｧu ﾄ黛ｻ品 h蘯｡n');
  },
  reviewDeadlineChange(id, decision, comment = '') {
    const reviewer = Auth.getCurrentUser(); const task = tasks.find(item => item.id === id); const req = task?.deadlineChangeRequest;
    if (reviewer?.role !== 'admin' || !task || req?.status !== 'pending' || !['approved','rejected'].includes(decision)) return false;
    req.status = decision; req.comment = String(comment).trim(); req.reviewerId = reviewer.id; req.reviewerName = reviewer.name; req.reviewedAt = new Date().toISOString();
    if (decision === 'approved') task.deadline = req.requestedDeadline;
    return this._commit(task, 'deadline-review', `Admin ${decision === 'approved' ? 'ﾄ妥｣ duy盻㏄' : 'ﾄ妥｣ t盻ｫ ch盻訴'} ﾄ黛ｻ品 h蘯｡n`);
  },
  submitTaskForReview(id, text, attachments = []) {
    const task = tasks.find(item => item.id === id); const user = Auth.getCurrentUser(); const content = String(text || '').trim();
    if (!task || !user || !['user','manager'].includes(user.role) || task.assigneeId !== user.id || !['in-progress','needs-revision'].includes(task.status) || task.cancellationRequest?.status === 'pending' || !content) return false;
    task.reports ||= []; task.statusBeforeReview = task.status;
    task.reports.unshift({ id:`report_${Date.now()}`, text:content, attachments, userId:user.id, username:user.username, createdAt:new Date().toISOString(), type:'completion', review:null });
    task.status='awaiting-review'; task.submittedForReviewAt=new Date().toISOString();
    return this._commit(task, 'submitted', 'ﾄ静｣ g盻ｭi yﾃｪu c蘯ｧu duy盻㏄ hoﾃn thﾃnh');
  },
  withdrawTaskCompletionRequest(id) {
    const task=tasks.find(item=>item.id===id); const user=Auth.getCurrentUser(); const report=task?.reports?.find(item=>item.type==='completion'&&item.userId===user?.id&&!item.review&&!item.withdrawnAt);
    if (!task||!user||!['user','manager'].includes(user.role)||task.assigneeId!==user.id||task.status!=='awaiting-review'||task.cancellationRequest?.status==='pending'||!report) return false;
    report.withdrawnAt=new Date().toISOString(); report.withdrawnReason='assignee-withdrawal'; task.status=['in-progress','needs-revision'].includes(task.statusBeforeReview)?task.statusBeforeReview:'in-progress'; delete task.statusBeforeReview; delete task.submittedForReviewAt;
    return this._commit(task, 'withdraw-submission', 'ﾄ静｣ rﾃｺt yﾃｪu c蘯ｧu duy盻㏄');
  },
  acceptTask(id) {
    const task=tasks.find(item=>item.id===id); const user=Auth.getCurrentUser();
    if(!user||!['user','manager'].includes(user.role)||!task||task.assigneeId!==user.id||task.status!=='pending')return false;
    task.status='in-progress'; task.acceptedAt=new Date().toISOString(); return this._commit(task,'accepted','ﾄ静｣ nh蘯ｭn cﾃｴng vi盻㌘');
  },
  cancelAssignedTask(id, reason) {
    const task=tasks.find(item=>item.id===id); const user=Auth.getCurrentUser(); const text=String(reason||'').trim();
    if(!user||!['user','manager'].includes(user.role)||!task||task.assigneeId!==user.id||!text||task.cancellationRequest?.status==='pending')return false;
    task.reports||=[]; const requestedAt=new Date().toISOString(); const reportId=`report_${Date.now()}`;
    task.reports.unshift({id:reportId,text:`Yﾃ涯 C蘯ｦU H盻ｦY VI盻・: ${text}`,userId:user.id,username:user.username,createdAt:requestedAt,type:'cancellation',review:null});
    task.cancellationRequest={status:'pending',reason:text,reportId,requestedBy:user.id,requestedAt}; return this._commit(task,'cancel-request','ﾄ静｣ g盻ｭi yﾃｪu c蘯ｧu h盻ｧy');
  },
  reviewCancellationRequest(id, decision, comment='') {
    const user=Auth.getCurrentUser(); const task=tasks.find(item=>item.id===id); const req=task?.cancellationRequest;
    if(user?.role!=='admin'||!task||req?.status!=='pending'||!['approved','rejected'].includes(decision))return false;
    req.status=decision; req.comment=String(comment).trim(); req.reviewerId=user.id; req.reviewerName=user.name; req.reviewedAt=new Date().toISOString(); if(decision==='approved')task.status='cancelled';
    const report=task.reports?.find(item=>item.id===req.reportId); if(report)report.review={decision,comment:req.comment,reviewerId:user.id,reviewerName:user.name,reviewedAt:req.reviewedAt};
    return this._commit(task,'cancel-review',`Admin ${decision==='approved'?'ﾄ妥｣ duy盻㏄':'ﾄ妥｣ t盻ｫ ch盻訴'} h盻ｧy vi盻㌘`);
  },
  reopenCancelledTask(id) {
    const user=Auth.getCurrentUser(); const task=tasks.find(item=>item.id===id);
    if(!user||!task||task.status!=='cancelled'||!(user.role==='admin'||task.assigneeId===user.id))return false;
    (task.reports||[]).forEach(report=>{if(report.type==='completion'&&!report.review&&!report.withdrawnAt){report.withdrawnAt=new Date().toISOString();report.withdrawnReason='task-cancelled';}});
    task.status='in-progress'; task.reopenedAt=new Date().toISOString(); task.cancellationRequest={...(task.cancellationRequest||{}),status:'reopened',reopenedAt:task.reopenedAt,reopenedBy:user.id}; return this._commit(task,'reopened','ﾄ静｣ m盻・l蘯｡i cﾃｴng vi盻㌘');
  },
  withdrawCancellationRequest(id) {
    const user=Auth.getCurrentUser(); const task=tasks.find(item=>item.id===id); const req=task?.cancellationRequest;
    if(user?.role!=='user'||!task||task.assigneeId!==user.id||req?.status!=='pending')return false;
    req.status='withdrawn';req.withdrawnAt=new Date().toISOString();req.withdrawnBy=user.id;return this._commit(task,'withdraw-cancel','ﾄ静｣ rﾃｺt yﾃｪu c蘯ｧu h盻ｧy');
  },
  reviewTaskReport(id, reportId, {decision,comment='',score=null}) {
    const user=Auth.getCurrentUser(); const task=tasks.find(item=>item.id===id); const report=task?.reports?.find(item=>item.id===reportId);
    if(user?.role!=='admin'||!task||task.status!=='awaiting-review'||task.cancellationRequest?.status==='pending'||!report||report.type!=='completion'||report.review||report.withdrawnAt||!['approved','rejected'].includes(decision)||(decision==='rejected'&&!String(comment).trim()))return false;
    const reviewedAt=new Date().toISOString(); report.review={decision,score:score==null?null:Math.min(10,Math.max(1,Number(score))),comment:String(comment).trim(),reviewerId:user.id,reviewerName:user.name,reviewedAt}; task.status=decision==='approved'?'completed':'needs-revision';delete task.statusBeforeReview;
    if(decision==='approved'&&['weekly','monthly'].includes(task.recurrence?.frequency)){const next=new Date(`${task.deadline}T12:00:00`);if(task.recurrence.frequency==='weekly')next.setDate(next.getDate()+7);else{const day=next.getDate();next.setDate(1);next.setMonth(next.getMonth()+1);next.setDate(Math.min(day,new Date(next.getFullYear(),next.getMonth()+1,0).getDate()));}const recurring={...task,id:`recurring_${Date.now()}`,deadline:next.toISOString().slice(0,10),createdAt:new Date().toISOString().slice(0,10),status:'pending',reports:[],comments:[],activity:[],subtasks:(task.subtasks||[]).map(item=>({...item,id:`sub_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,done:false})),cancellationRequest:null,deadlineChangeRequest:null,submittedForReviewAt:null,acceptedAt:null};tasks.unshift(recurring);if(apiAvailable)request('/tasks',{method:'POST',body:JSON.stringify(recurring)}).catch(console.error);}
    return this._commit(task,'review',`Admin ${decision==='approved'?'ﾄ妥｣ duy盻㏄ hoﾃn thﾃnh':'yﾃｪu c蘯ｧu lﾃm l蘯｡i'}`);
  },
  requestTaskRevision(id, comment) {
    const user=Auth.getCurrentUser(); const task=tasks.find(item=>item.id===id); const reason=String(comment||'').trim();
    if(user?.role!=='admin'||!task||task.status!=='completed'||!reason)return false;
    const reviewedAt=new Date().toISOString();task.status='needs-revision';task.reports||=[];task.reports.unshift({id:`admin_revision_${Date.now()}`,text:'Admin yﾃｪu c蘯ｧu lﾃm l蘯｡i cﾃｴng vi盻㌘.',userId:user.id,username:user.username,createdAt:reviewedAt,type:'admin-review',review:{decision:'rejected',comment:reason,reviewerId:user.id,reviewerName:user.name,reviewedAt}});return this._commit(task,'revision','Admin yﾃｪu c蘯ｧu lﾃm l蘯｡i');
  },
  updateTask(id, fields) {
    const task=tasks.find(item=>item.id===id);if(!task||!Auth.canAccessTask(task))return false;let safe={...fields};
    if(!Auth.canEditTask(task)){const allowed={};if(Auth.canReportTask(task)&&Object.hasOwn(safe,'reports'))allowed.reports=safe.reports;if(Auth.canManageSubtasks(task)&&Object.hasOwn(safe,'subtasks'))allowed.subtasks=safe.subtasks;safe=allowed;}
    delete safe.status;if(!Object.keys(safe).length)return false;Object.assign(task,safe);return this._commit(task,'updated','ﾄ静｣ c蘯ｭp nh蘯ｭt cﾃｴng vi盻㌘');
  },
  deleteTask(id) {
    const task=tasks.find(item=>item.id===id);if(!task||!Auth.canEditTask(task))return false;tasks=tasks.filter(item=>item.id!==id);cache();
    return apiAvailable?request(`/tasks/${encodeURIComponent(id)}`,{method:'DELETE'}).then(()=>true).catch(error=>{tasks.push(task);cache();console.error(error);return false;}):true;
  },
  addCategory(category) {
    if(!Auth.canManageCategories())return false;categories.push(category);cache();
    return apiAvailable?request('/categories',{method:'POST',body:JSON.stringify(category)}).then(()=>true).catch(error=>{categories=categories.filter(item=>item.id!==category.id);cache();console.error(error);return false;}):true;
  },
  deleteCategory(id) {
    if(!Auth.canManageCategories()||!categories.some(item=>item.id===id))return false;const old=categories;categories=categories.filter(item=>item.id!==id);cache();
    return apiAvailable?request(`/categories/${encodeURIComponent(id)}`,{method:'DELETE'}).then(()=>true).catch(error=>{categories=old;cache();console.error(error);return false;}):true;
  },
  _commit(task,type,text) {
    const user=Auth.getCurrentUser();task.activity=Array.isArray(task.activity)?task.activity:[];task.activity.unshift({id:`activity_${Date.now()}`,type,text,userId:user?.id,userName:user?.name||'Ngﾆｰ盻拱 dﾃｹng',createdAt:new Date().toISOString()});task.updatedAt=new Date().toISOString();cache();
    if(apiAvailable){request(`/tasks/${encodeURIComponent(task.id)}`,{method:'PUT',body:JSON.stringify(task)}).catch(error=>console.error('Could not sync task.',error));}
    return true;
  }
};

window.addEventListener('online', () => {
  if (!apiAvailable) return;
  tasks.forEach(task => request(`/tasks/${encodeURIComponent(task.id)}`, { method: 'PUT', body: JSON.stringify(task) }).catch(error => console.error('Could not sync cached task.', error)));
});



