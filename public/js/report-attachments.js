const DATABASE_NAME = 'taskmaster-report-attachments';
const STORE_NAME = 'files';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => { database.close(); resolve(result); };
    transaction.onabort = () => { database.close(); reject(transaction.error || new Error('Attachment storage failed.')); };
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error('Attachment storage failed.')); };
  });
}

export const ReportAttachments = {
  save(id, file) {
    return withStore('readwrite', store => store.put(file, id));
  },
  get(id) {
    return withStore('readonly', store => store.get(id));
  },
  remove(id) {
    return withStore('readwrite', store => store.delete(id));
  }
};
