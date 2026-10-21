const DATABASE_NAME = "geoionosfera-local";
const DATABASE_VERSION = 1;
const STORE_NAME = "reports";
const MAX_REPORTS_PER_SITE = 60;

let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("siteId", "siteId", { unique: false });
      store.createIndex("savedAt", "savedAt", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return databasePromise;
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveReport(report) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  const index = store.index("siteId");
  const existing = await new Promise((resolve, reject) => {
    const request = index.getAll(report.siteId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  store.put(report);
  existing
    .filter((item) => item.id !== report.id)
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt))
    .slice(MAX_REPORTS_PER_SITE - 1)
    .forEach((item) => store.delete(item.id));
  await transactionDone(transaction);
}

export async function listReports(siteId, limit = 12) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const request = transaction.objectStore(STORE_NAME).index("siteId").getAll(siteId);
  const result = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return result.sort((left, right) => right.savedAt.localeCompare(left.savedAt)).slice(0, limit);
}

export async function listAllReports() {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const request = transaction.objectStore(STORE_NAME).getAll();
  const result = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return result.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

export async function deleteSiteReports(siteId) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  const index = store.index("siteId");
  const request = index.openKeyCursor(IDBKeyRange.only(siteId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    store.delete(cursor.primaryKey);
    cursor.continue();
  };
  await transactionDone(transaction);
}

export async function clearReports() {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).clear();
  await transactionDone(transaction);
}