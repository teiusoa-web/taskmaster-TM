
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

function isTaskAssignee(task, userId) {
  return Boolean(
    userId &&
    task &&
    (task.assigneeId === userId || (Array.isArray(task.assigneeIds) && task.assigneeIds.includes(userId)))
  );
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
    const isUserRequest = user.role === 'user';
    const newTask = {
      ...task,
      ownerId: user.id,
      status: isUserRequest ? 'request-pending' : 'pending',
      ...(isUserRequest ? {
        requestReview: {
          status: 'pending',
          requestedBy: user.id,
          requestedByName: user.name,
          requestedAt: new Date().toISOString()
        }
      } : {}),
      activity: [{
        id: `activity_${Date.now()}`,
        type: 'created',
        text: isUserRequest ? 'Đã gửi yêu cầu công việc' : 'Đã tạo công việc',
        userId: user.id,
        userName: user.name,
        createdAt: new Date().toISOString()
      }]
    };
    tasks.unshift(newTask); cache();
    return apiAvailable ? request('/tasks', { method: 'POST', body: JSON.stringify(newTask) }).then(() => true).catch(error => { tasks.shift(); cache(); console.error(error); return false; }) : true;
  },
  reviewTaskRequest(id, decision, assigneeId = '', comment = '') {
    const user = Auth.getCurrentUser();
    const task = tasks.find(item => item.id === id);
    if (user?.role !== 'admin' || !task || !['approved', 'rejected'].includes(decision)) return false;
    if (decision === 'approved' && !assigneeId) return false;
    task.requestReview = {
      ...(task.requestReview || {}),
      status: decision,
      comment: String(comment || '').trim(),
      reviewerId: user.id,
      reviewerName: user.name,
      reviewedAt: new Date().toISOString()
    };
    if (decision === 'approved') {
      task.status = 'pending';
      task.assigneeId = assigneeId;
      task.assigneeIds = [assigneeId];
    } else {
      task.status = 'cancelled';
    }
    return this._commit(
      task,
      'request-review',
      decision === 'approved' ? 'Admin đã duyệt và giao việc' : 'Admin đã từ chối yêu cầu công việc'
    );
  },
  addSubtaskMessage(taskId, subtaskId, text, attachments = [], replyToId = null) {
    const task = tasks.find(item => item.id === taskId);
    const user = Auth.getCurrentUser();
    const content = String(text || '').trim();
    const files = Array.isArray(attachments) ? attachments : [];
    if (!task || !user || !Auth.canAccessTask(task) || (!content && !files.length)) return false;
    const subtask = (Array.isArray(task.subtasks) ? task.subtasks : []).find(item => item.id === subtaskId);
    if (!subtask) return false;
    subtask.comments ||= [];
    const replyTarget = replyToId ? subtask.comments.find(item => item.id === replyToId) : null;
    subtask.comments.push({
      id: `submsg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId: user.id,
      username: user.username,
      name: user.name,
      text: content,
      attachments: files,
      replyToId: replyTarget?.id || null,
      replyToName: replyTarget ? (replyTarget.name || replyTarget.username) : null,
      replyPreview: replyTarget ? String(replyTarget.text || '').slice(0, 120) : null,
      createdAt: new Date().toISOString()
    });
    return this._commit(task, 'subtask-comment', 'Đã trao đổi trong checklist');
  },
  addTaskReport(id, text, attachments = []) {
    const task = tasks.find(item => item.id === id);
    if (!task || !Auth.canReportTask(task) || !String(text || '').trim()) return false;
    const user = Auth.getCurrentUser(); task.reports ||= [];
    task.reports.unshift({ id: `report_${Date.now()}`, text: text.trim(), attachments, userId: user.id, username: user.username, createdAt: new Date().toISOString(), type: 'progress', review: null });
    if (task.status === 'needs-revision') task.status = 'in-progress';
    return this._commit(task, 'progress', 'Đã gửi báo cáo tiến độ');
  },
  addTaskComment(id, text, replyTo = null) {
    const task = tasks.find(item => item.id === id); const user = Auth.getCurrentUser(); const content = String(text || '').trim();
    if (!task || !user || !content || !Auth.canAccessTask(task)) return false;
    task.comments ||= [];
    const entry = { id: `comment_${Date.now()}`, text: content, userId: user.id, username: user.username, name: user.name, createdAt: new Date().toISOString() };
    if (replyTo && replyTo.id) {
      entry.replyTo = {
        id: String(replyTo.id),
        userId: replyTo.userId ? String(replyTo.userId) : '',
        name: String(replyTo.name || 'Người dùng'),
        text: String(replyTo.text || '').slice(0, 140)
      };
    }
    task.comments.unshift(entry);
    return this._commit(task, 'comment', replyTo ? `Đã phản hồi ${entry.replyTo.name}` : 'Đã thêm bình luận');
  },
  requestDeadlineChange(id, deadline, reason) {
    const user = Auth.getCurrentUser(); const task = tasks.find(item => item.id === id); const note = String(reason || '').trim();
    if (!user || !['user','manager'].includes(user.role) || !task || !isTaskAssignee(task, user.id) || !deadline || !note || ['completed','cancelled'].includes(task.status) || task.deadlineChangeRequest?.status === 'pending') return false;
    task.deadlineChangeRequest = { status:'pending', requestedDeadline:deadline, reason:note, requestedBy:user.id, requestedByName:user.name, requestedAt:new Date().toISOString() };
    return this._commit(task, 'deadline-request', 'Đã yêu cầu đổi hạn');
  },
  reviewDeadlineChange(id, decision, comment = '') {
    const reviewer = Auth.getCurrentUser(); const task = tasks.find(item => item.id === id); const req = task?.deadlineChangeRequest;
    if (reviewer?.role !== 'admin' || !task || req?.status !== 'pending' || !['approved','rejected'].includes(decision)) return false;
    req.status = decision; req.comment = String(comment).trim(); req.reviewerId = reviewer.id; req.reviewerName = reviewer.name; req.reviewedAt = new Date().toISOString();
    if (decision === 'approved') task.deadline = req.requestedDeadline;
    return this._commit(task, 'deadline-review', `Admin ${decision === 'approved' ? 'đã duyệt' : 'đã từ chối'} hạn`);
  },
  submitTaskForReview(id, text, attachments = []) {
    const task = tasks.find(item => item.id === id); const user = Auth.getCurrentUser(); const content = String(text || '').trim();
    if (!task || !user || !['user','manager'].includes(user.role) || !isTaskAssignee(task, user.id) || !['in-progress','needs-revision'].includes(task.status) || task.cancellationRequest?.status === 'pending' || !content) return false;
    task.reports ||= []; task.statusBeforeReview = task.status;
    task.reports.unshift({ id:`report_${Date.now()}`, text:content, attachments, userId:user.id, username:user.username, createdAt:new Date().toISOString(), type:'completion', review:null });
    task.status='awaiting-review'; task.submittedForReviewAt=new Date().toISOString();
    return this._commit(task, 'submitted', 'Đã gửi yêu cầu duyệt hoàn thành');
  },
  withdrawTaskCompletionRequest(id) {
    const task=tasks.find(item=>item.id===id); const user=Auth.getCurrentUser(); const report=task?.reports?.find(item=>item.type==='completion'&&item.userId===user?.id&&!item.review&&!item.withdrawnAt);
    if (!task||!user||!['user','manager'].includes(user.role)||!isTaskAssignee(task, user.id)||task.status!=='awaiting-review'||task.cancellationRequest?.status==='pending'||!report) return false;
    report.withdrawnAt=new Date().toISOString(); report.withdrawnReason='assignee-withdrawal'; task.status=['in-progress','needs-revision'].includes(task.statusBeforeReview)?task.statusBeforeReview:'in-progress'; delete task.statusBeforeReview; delete task.submittedForReviewAt;
    return this._commit(task, 'withdraw-submission', 'Đã rút yêu cầu duyệt');
  },
  acceptTask(id) {
    const task=tasks.find(item=>item.id===id); const user=Auth.getCurrentUser();
    if(!user||!['user','manager'].includes(user.role)||!task||!isTaskAssignee(task, user.id)||task.status!=='pending')return false;
    task.status='in-progress'; task.acceptedAt=new Date().toISOString(); return this._commit(task,'accepted','Đã nhận công việc');
  },
  cancelAssignedTask(id, reason) {
    const task=tasks.find(item=>item.id===id); const user=Auth.getCurrentUser(); const text=String(reason||'').trim();
    if(!user||!['user','manager'].includes(user.role)||!task||!isTaskAssignee(task, user.id)||!text||task.cancellationRequest?.status==='pending')return false;
    task.reports||=[]; const requestedAt=new Date().toISOString(); const reportId=`report_${Date.now()}`;
    task.reports.unshift({id:reportId,text:`YÊU CẦU HỦY VIỆC: ${text}`,userId:user.id,username:user.username,createdAt:requestedAt,type:'cancellation',review:null});
    task.cancellationRequest={status:'pending',reason:text,reportId,requestedBy:user.id,requestedAt}; return this._commit(task,'cancel-request','Đã gửi yêu cầu hủy');
  },
  reviewCancellationRequest(id, decision, comment='') {
    const user=Auth.getCurrentUser(); const task=tasks.find(item=>item.id===id); const req=task?.cancellationRequest;
    if(user?.role!=='admin'||!task||req?.status!=='pending'||!['approved','rejected'].includes(decision))return false;
    req.status=decision; req.comment=String(comment).trim(); req.reviewerId=user.id; req.reviewerName=user.name; req.reviewedAt=new Date().toISOString(); if(decision==='approved')task.status='cancelled';
    const report=task.reports?.find(item=>item.id===req.reportId); if(report)report.review={decision,comment:req.comment,reviewerId:user.id,reviewerName:user.name,reviewedAt:req.reviewedAt};
    return this._commit(task,'cancel-review',`Admin ${decision==='approved'?'đã duyệt':'đã từ chối'} hủy việc`);
  },
  reopenCancelledTask(id) {
    const user=Auth.getCurrentUser(); const task=tasks.find(item=>item.id===id);
    if(!user||!task||task.status!=='cancelled'||!(user.role==='admin'||task.ownerId===user.id||isTaskAssignee(task, user.id)))return false;
    (task.reports||[]).forEach(report=>{if(report.type==='completion'&&!report.review&&!report.withdrawnAt){report.withdrawnAt=new Date().toISOString();report.withdrawnReason='task-cancelled';}});
    task.status='in-progress'; task.reopenedAt=new Date().toISOString(); task.cancellationRequest={...(task.cancellationRequest||{}),status:'reopened',reopenedAt:task.reopenedAt,reopenedBy:user.id}; return this._commit(task,'reopened','Đã mở lại công việc');
  },
  withdrawCancellationRequest(id) {
    const user=Auth.getCurrentUser(); const task=tasks.find(item=>item.id===id); const req=task?.cancellationRequest;
    if(!['user','manager'].includes(user?.role)||!task||!isTaskAssignee(task, user.id)||req?.status!=='pending')return false;
    req.status='withdrawn';req.withdrawnAt=new Date().toISOString();req.withdrawnBy=user.id;return this._commit(task,'withdraw-cancel','Đã rút yêu cầu hủy');
  },
  reviewTaskReport(id, reportId, {decision,comment='',score=null}) {
    const user=Auth.getCurrentUser(); const task=tasks.find(item=>item.id===id); const report=task?.reports?.find(item=>item.id===reportId);
    if(user?.role!=='admin'||!task||task.status!=='awaiting-review'||task.cancellationRequest?.status==='pending'||!report||report.type!=='completion'||report.review||report.withdrawnAt||!['approved','rejected'].includes(decision)||(decision==='rejected'&&!String(comment).trim()))return false;
    const reviewedAt=new Date().toISOString(); report.review={decision,score:score==null?null:Math.min(10,Math.max(1,Number(score))),comment:String(comment).trim(),reviewerId:user.id,reviewerName:user.name,reviewedAt}; task.status=decision==='approved'?'completed':'needs-revision';delete task.statusBeforeReview;
    if(decision==='approved'&&['daily','weekly','weekly-fixed','monthly','monthly-fixed'].includes(task.recurrence?.frequency)){const freq=task.recurrence.frequency;const next=new Date(`${task.deadline}T12:00:00`);if(freq==='daily'){next.setDate(next.getDate()+1);}else if(freq==='weekly'||freq==='weekly-fixed'){next.setDate(next.getDate()+7);}else{const day=next.getDate();next.setDate(1);next.setMonth(next.getMonth()+1);next.setDate(Math.min(day,new Date(next.getFullYear(),next.getMonth()+1,0).getDate()));}const nextDateStr=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`;const withinEndDate=!task.recurrence.endDate||nextDateStr<=task.recurrence.endDate;if(withinEndDate){const recurring={...task,id:`recurring_${Date.now()}`,deadline:nextDateStr,deadlineTime:task.deadlineTime||'',createdAt:new Date().toISOString().slice(0,10),status:'pending',reports:[],comments:[],activity:[],subtasks:(task.subtasks||[]).map(item=>({...item,id:`sub_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,done:false,comments:[]})),cancellationRequest:null,deadlineChangeRequest:null,submittedForReviewAt:null,acceptedAt:null};tasks.unshift(recurring);if(apiAvailable)request('/tasks',{method:'POST',body:JSON.stringify(recurring)}).catch(console.error);}}
    return this._commit(task,'review',`Admin ${decision==='approved'?'đã duyệt hoàn thành':'yêu cầu làm lại'}`);
  },
  requestTaskRevision(id, comment) {
    const user=Auth.getCurrentUser(); const task=tasks.find(item=>item.id===id); const reason=String(comment||'').trim();
    if(user?.role!=='admin'||!task||task.status!=='completed'||!reason)return false;
    const reviewedAt=new Date().toISOString();task.status='needs-revision';task.reports||=[];task.reports.unshift({id:`admin_revision_${Date.now()}`,text:'Admin yêu cầu làm lại công việc.',userId:user.id,username:user.username,createdAt:reviewedAt,type:'admin-review',review:{decision:'rejected',comment:reason,reviewerId:user.id,reviewerName:user.name,reviewedAt}});return this._commit(task,'revision','Admin yêu cầu làm lại');
  },
  updateTask(id, fields) {
    const task=tasks.find(item=>item.id===id);if(!task||!Auth.canAccessTask(task))return false;let safe={...fields};
    if(!Auth.canEditTask(task)){const allowed={};if(Auth.canReportTask(task)&&Object.hasOwn(safe,'reports'))allowed.reports=safe.reports;if(Auth.canManageSubtasks(task)&&Object.hasOwn(safe,'subtasks'))allowed.subtasks=safe.subtasks;safe=allowed;}
    delete safe.status;if(!Object.keys(safe).length)return false;Object.assign(task,safe);return this._commit(task,'updated','Đã cập nhật công việc');
  },
  deleteTask(id) {
    const task=tasks.find(item=>item.id===id);if(!task||!Auth.canEditTask(task))return false;tasks=tasks.filter(item=>item.id!==id);cache();
    return apiAvailable?request(`/tasks/${encodeURIComponent(id)}`,{method:'DELETE'}).then(()=>true).catch(error=>{tasks.push(task);cache();console.error(error);return false;}):true;
  },
  addCategory(category) {
    if(!Auth.canManageCategories())return false;categories.push(category);cache();
    return apiAvailable?request('/categories',{method:'POST',body:JSON.stringify(category)}).then(()=>true).catch(error=>{categories=categories.filter(item=>item.id!==category.id);cache();console.error(error);return false;}):true;
  },
  updateCategory(id, changes) {
    if(!Auth.canManageCategories())return false;
    const index=categories.findIndex(item=>item.id===id);
    if(index<0)return false;
    const previousCat={...categories[index]};
    const nextName=String(changes?.name??previousCat.name).trim();
    if(!nextName)return false;
    const updatedCat={
      ...previousCat,
      name:nextName,
      color:/^#[0-9a-f]{3,8}$/i.test(changes?.color||'')?changes.color:previousCat.color
    };
    categories[index]=updatedCat;
    const affectedTasks=[];
    tasks.forEach(task=>{
      if(task.categoryId===id&&task.categoryName!==updatedCat.name){
        task.categoryName=updatedCat.name;
        affectedTasks.push(task);
      }
    });
    cache();
    if(!apiAvailable)return true;
    return Promise.all([
      request(`/categories/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(updatedCat)}),
      ...affectedTasks.map(t=>request(`/tasks/${encodeURIComponent(t.id)}`,{method:'PUT',body:JSON.stringify(t)}))
    ]).then(()=>true).catch(error=>{
      categories[index]=previousCat;
      cache();
      console.error('Could not update category.',error);
      return false;
    });
  },
  deleteCategory(id) {
    if(!Auth.canManageCategories()||!categories.some(item=>item.id===id))return false;const old=categories;categories=categories.filter(item=>item.id!==id);cache();
    return apiAvailable?request(`/categories/${encodeURIComponent(id)}`,{method:'DELETE'}).then(()=>true).catch(error=>{categories=old;cache();console.error(error);return false;}):true;
  },
  _commit(task,type,text) {
    const user=Auth.getCurrentUser();task.activity=Array.isArray(task.activity)?task.activity:[];task.activity.unshift({id:`activity_${Date.now()}`,type,text,userId:user?.id,userName:user?.name||'Người dùng',createdAt:new Date().toISOString()});task.updatedAt=new Date().toISOString();cache();
    if(apiAvailable){request(`/tasks/${encodeURIComponent(task.id)}`,{method:'PUT',body:JSON.stringify(task)}).catch(error=>console.error('Could not sync task.',error));}
    return true;
  }
};

window.addEventListener('online', () => {
  if (!apiAvailable) return;
  tasks.forEach(task => request(`/tasks/${encodeURIComponent(task.id)}`, { method: 'PUT', body: JSON.stringify(task) }).catch(error => console.error('Could not sync cached task.', error)));
});



