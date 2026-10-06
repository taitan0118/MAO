// Cho trang web biết đang chạy trong ứng dụng desktop: in thẳng và hiện thông báo Windows
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('msaoDesktop', {
  printReceipt: () => ipcRenderer.invoke('print-receipt'),
  notify: msg => ipcRenderer.send('notify', msg)
});
